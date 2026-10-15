import { Inject, Injectable } from "@nestjs/common";
import type { InvitationStatus, Prisma, UserStatus } from "@sqms/db";
import type { AppEnv } from "@sqms/server-core";
import { ROLE_KEYS } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { hashToken, newOpaqueToken, SessionService } from "../../common/auth/session.service";
import { AuditService } from "../../common/audit/audit.service";
import { DbService, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from "../../common/errors/app-errors";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { SettingsService } from "../../common/services/settings.service";
import { APP_ENV } from "../../infra/tokens";
import type { CreateRoleDto, InvitationListQuery, InviteUserDto, UpdateUserDto, UserListQuery } from "./admin.dto";

const INVITATION_DAYS = 7;
/** Never returned by the API. */
const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  userType: true,
  status: true,
  timezone: true,
  jobTitle: true,
  department: true,
  phone: true,
  lastLoginAt: true,
  lockedUntil: true,
  failedLoginCount: true,
  mfaRequired: true,
  disabledAt: true,
  disabledReason: true,
  createdAt: true,
  updatedAt: true,
  memberships: { select: { id: true, status: true, organization: { select: { id: true, name: true, type: true, code: true } }, roles: { select: { role: { select: { id: true, key: true, name: true, scope: true } } } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  // ------------------------------------------------------------------ users

  async list(q: UserListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.UserWhereInput = {
      ...(q.userType ? { userType: q.userType } : {}),
      ...(q.status?.length ? { status: { in: q.status as UserStatus[] } } : {}),
      ...(q.organizationId ? { memberships: { some: { organizationId: q.organizationId } } } : {}),
      ...(q.roleKey ? { memberships: { some: { status: "ACTIVE", roles: { some: { role: { key: q.roleKey } } } } } } : {}),
      ...(term ? { OR: [{ email: { contains: term } }, { displayName: { contains: term } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.client.user.count({ where }),
      this.db.client.user.findMany({ where, skip, take, orderBy: sortArg(q, ["displayName", "email", "lastLoginAt", "createdAt", "status"] as const, "displayName", "asc"), select: USER_SELECT }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(id: string) {
    const user = await this.db.client.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundError("User");
    const activeSessions = await this.db.client.authSession.count({ where: { userId: id, revokedAt: null, idleExpiresAt: { gt: new Date() }, absoluteExpiresAt: { gt: new Date() } } });
    return { ...user, activeSessions };
  }

  async update(actor: Actor, id: string, dto: UpdateUserDto) {
    await this.db.tx(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("User");
      const after = await tx.user.update({ where: { id }, data: dto });
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      for (const k of Object.keys(dto) as (keyof UpdateUserDto)[]) if (before[k] !== after[k]) changes[k] = { before: before[k], after: after[k] };
      await this.audit.record({ eventType: "admin.user.updated", entityType: "USER", entityId: id, entityLabel: before.email, changes: Object.keys(changes).length ? changes : null }, tx);
    });
    return this.get(id);
  }

  private async activeAdminCount(tx: Tx, excludeUserId?: string) {
    return tx.user.count({
      where: { status: "ACTIVE", userType: "INTERNAL", ...(excludeUserId ? { id: { not: excludeUserId } } : {}), memberships: { some: { status: "ACTIVE", roles: { some: { role: { key: ROLE_KEYS.SYSTEM_ADMIN } } } } } },
    });
  }

  private async isAdmin(tx: Tx, userId: string) {
    return (await tx.membershipRole.count({ where: { membership: { userId, status: "ACTIVE" }, role: { key: ROLE_KEYS.SYSTEM_ADMIN } } })) > 0;
  }

  async setStatus(actor: Actor, id: string, status: "ACTIVE" | "DISABLED", reason: string) {
    if (id === actor.userId && status === "DISABLED") throw new BusinessRuleError("You cannot disable your own account");
    await this.db.tx(async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw new NotFoundError("User");
      if (u.status === status) return;
      if (status === "DISABLED" && (await this.isAdmin(tx, id)) && (await this.activeAdminCount(tx, id)) === 0) throw new BusinessRuleError("The last active system administrator cannot be disabled");
      if (status === "ACTIVE" && !u.passwordHash && u.status === "INVITED") throw new BusinessRuleError("The user has not accepted the invitation yet");
      await tx.user.update({ where: { id }, data: status === "DISABLED" ? { status, disabledAt: new Date(), disabledReason: reason } : { status, disabledAt: null, disabledReason: null, failedLoginCount: 0, lockedUntil: null } });
      // Disabling takes effect immediately: every session is revoked.
      const revoked = status === "DISABLED" ? await this.sessions.revokeAllForUser(id, "account_disabled", undefined, tx) : 0;
      await this.audit.record({ eventType: status === "DISABLED" ? "admin.user.disabled" : "admin.user.enabled", entityType: "USER", entityId: id, entityLabel: u.email, changes: { status: { before: u.status, after: status } }, reason, metadata: { revokedSessions: revoked } }, tx);
    });
    return this.get(id);
  }

  async unlock(actor: Actor, id: string) {
    await this.db.tx(async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw new NotFoundError("User");
      await tx.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
      await this.audit.record({ eventType: "admin.user.unlocked", entityType: "USER", entityId: id, entityLabel: u.email }, tx);
    });
    return this.get(id);
  }

  async revokeSessions(actor: Actor, id: string) {
    return this.db.tx(async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw new NotFoundError("User");
      const revoked = await this.sessions.revokeAllForUser(id, "admin_revoked", id === actor.userId ? actor.sessionId : undefined, tx);
      await this.audit.record({ eventType: "admin.user.sessions_revoked", entityType: "USER", entityId: id, entityLabel: u.email, metadata: { revoked } }, tx);
      return { revoked };
    });
  }

  /** Replaces the roles of one organization membership. Role scope must match the organization type. */
  async setRoles(actor: Actor, id: string, roleKeys: string[], reason: string, organizationId?: string) {
    await this.db.tx(async (tx) => {
      const u = await tx.user.findUnique({ where: { id }, include: { memberships: { include: { organization: true, roles: { include: { role: true } } } } } });
      if (!u) throw new NotFoundError("User");
      const membership = organizationId ? u.memberships.find((m) => m.organizationId === organizationId) : u.memberships.length === 1 ? u.memberships[0] : undefined;
      if (!membership) throw new BusinessRuleError(organizationId ? "The user is not a member of that organization" : "Specify the organization membership to update");
      const keys = [...new Set(roleKeys)];
      const roles = await tx.role.findMany({ where: { key: { in: keys } } });
      if (roles.length !== keys.length) throw new BusinessRuleError(`Unknown roles: ${keys.filter((k) => !roles.some((r) => r.key === k)).join(", ")}`);
      const expected = membership.organization.type === "INTERNAL" ? "INTERNAL" : "EXTERNAL";
      const wrong = roles.filter((r) => r.scope !== expected);
      if (wrong.length) throw new BusinessRuleError(`Roles ${wrong.map((r) => r.key).join(", ")} cannot be granted in a ${membership.organization.type.toLowerCase()} organization`);
      const before = membership.roles.map((r) => r.role.key).sort();
      const removingAdmin = before.includes(ROLE_KEYS.SYSTEM_ADMIN) && !keys.includes(ROLE_KEYS.SYSTEM_ADMIN);
      if (removingAdmin && id === actor.userId) throw new BusinessRuleError("You cannot remove your own administrator role");
      if (removingAdmin && (await this.activeAdminCount(tx, id)) === 0) throw new BusinessRuleError("At least one active system administrator is required");
      await tx.membershipRole.deleteMany({ where: { membershipId: membership.id, roleId: { notIn: roles.map((r) => r.id) } } });
      await tx.membershipRole.createMany({ data: roles.map((r) => ({ membershipId: membership.id, roleId: r.id, grantedById: actor.userId })), skipDuplicates: true });
      await this.audit.record({ eventType: "admin.user.roles_changed", entityType: "USER", entityId: id, entityLabel: u.email, changes: { roles: { before, after: keys.sort() } }, reason, metadata: { organizationId: membership.organizationId } }, tx);
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------ invitations

  async listInvitations(q: InvitationListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.InvitationWhereInput = { ...(q.status?.length ? { status: { in: q.status as InvitationStatus[] } } : {}), ...(term ? { email: { contains: term } } : {}) };
    const [total, items] = await Promise.all([
      this.db.client.invitation.count({ where }),
      this.db.client.invitation.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, displayName: true, status: true, expiresAt: true, createdAt: true, acceptedAt: true, organization: { select: { id: true, name: true, type: true } }, invitedBy: { select: { id: true, displayName: true } }, roles: { select: { role: { select: { key: true, name: true } } } } },
      }),
    ]);
    const now = new Date();
    return { total, page, pageSize, items: items.map((i) => ({ ...i, status: i.status === "PENDING" && i.expiresAt <= now ? "EXPIRED" : i.status })) };
  }

  async invite(actor: Actor, dto: InviteUserDto) {
    const email = dto.email.trim().toLowerCase();
    const org = dto.organizationId ? await this.db.client.organization.findUnique({ where: { id: dto.organizationId } }) : await this.db.client.organization.findUnique({ where: { code: "INTERNAL" } });
    if (!org || !org.isActive) throw new NotFoundError("Organization");
    // Phase 1: external supplier accounts stay disabled until the portal (with MFA) is enabled.
    if (org.type === "SUPPLIER" && !this.env.SUPPLIER_PORTAL_ENABLED) throw new ForbiddenError("Supplier portal access is not enabled; supplier users cannot be invited yet");
    const roles = await this.db.client.role.findMany({ where: { key: { in: [...new Set(dto.roleKeys)] } } });
    if (roles.length !== new Set(dto.roleKeys).size) throw new BusinessRuleError("Unknown role in the invitation");
    const expectedScope = org.type === "INTERNAL" ? "INTERNAL" : "EXTERNAL";
    if (roles.some((r) => r.scope !== expectedScope)) throw new BusinessRuleError(`Only ${expectedScope.toLowerCase()} roles can be granted for ${org.name}`);
    if (roles.some((r) => r.key === ROLE_KEYS.SYSTEM_ADMIN) && !actor.roles.includes(ROLE_KEYS.SYSTEM_ADMIN)) throw new ForbiddenError("Only system administrators can invite administrators");
    const existing = await this.db.client.user.findUnique({ where: { email }, include: { memberships: true } });
    if (existing?.passwordHash && existing.memberships.some((m) => m.organizationId === org.id)) throw new ConflictError("This user already has access; adjust their roles instead", "USER_EXISTS");
    if (existing && existing.userType !== expectedScope) throw new BusinessRuleError("This email is registered with a different account type");
    const token = newOpaqueToken();
    const branding = await this.settings.get<{ productName?: string }>("branding", {});
    return this.db.tx(async (tx, after) => {
      await tx.invitation.updateMany({ where: { email, organizationId: org.id, status: "PENDING" }, data: { status: "REVOKED" } });
      const inv = await tx.invitation.create({
        data: { email, displayName: dto.displayName ?? null, organizationId: org.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000), invitedById: actor.userId, roles: { create: roles.map((r) => ({ roleId: r.id })) } },
      });
      const link = `${this.env.APP_BASE_URL.replace(/\/$/, "")}/accept-invitation?token=${encodeURIComponent(token)}`;
      await this.notifications.sendDirectEmail(tx, after, {
        to: email,
        subject: `[${branding.productName ?? "SQMS"}] You have been invited`,
        body: `${actor.displayName} invited you to ${branding.productName ?? "SQMS"} (${org.name}).\n\nAccept the invitation and set your password (valid for ${INVITATION_DAYS} days): ${link}`,
      });
      await this.audit.record({ eventType: "admin.invitation.created", entityType: "USER", entityId: existing?.id, entityLabel: email, metadata: { invitationId: inv.id, organizationId: org.id, roles: roles.map((r) => r.key) } }, tx);
      return { id: inv.id, email, organizationId: org.id, expiresAt: inv.expiresAt, roles: roles.map((r) => r.key) };
    });
  }

  async revokeInvitation(actor: Actor, id: string) {
    return this.db.tx(async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { id } });
      if (!inv) throw new NotFoundError("Invitation");
      if (inv.status !== "PENDING") throw new BusinessRuleError(`The invitation is ${inv.status}`);
      await tx.invitation.update({ where: { id }, data: { status: "REVOKED" } });
      await this.audit.record({ eventType: "admin.invitation.revoked", entityLabel: inv.email, metadata: { invitationId: id } }, tx);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ roles & permissions

  async roles() {
    const roles = await this.db.client.role.findMany({ orderBy: [{ scope: "asc" }, { name: "asc" }], include: { permissions: { include: { permission: true } }, _count: { select: { memberships: true } } } });
    return roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, scope: r.scope, isSystem: r.isSystem, memberCount: r._count.memberships, permissions: r.permissions.map((p) => p.permission.key).sort() }));
  }

  permissions() {
    return this.db.client.permission.findMany({ orderBy: { key: "asc" }, select: { key: true, description: true, externalAllowed: true } });
  }

  private async resolvePermissions(tx: Tx, keys: string[], scope: "INTERNAL" | "EXTERNAL") {
    const unique = [...new Set(keys)];
    const perms = await tx.permission.findMany({ where: { key: { in: unique } } });
    if (perms.length !== unique.length) throw new BusinessRuleError(`Unknown permissions: ${unique.filter((k) => !perms.some((p) => p.key === k)).join(", ")}`);
    // External roles can never hold internal-only permissions, whatever an administrator selects.
    const forbidden = scope === "EXTERNAL" ? perms.filter((p) => !p.externalAllowed) : [];
    if (forbidden.length) throw new BusinessRuleError(`Permissions not allowed for supplier roles: ${forbidden.map((p) => p.key).join(", ")}`);
    return perms;
  }

  async createRole(actor: Actor, dto: CreateRoleDto) {
    return this.db.tx(async (tx) => {
      if (await tx.role.findUnique({ where: { key: dto.key } })) throw new ConflictError("A role with this key already exists", "DUPLICATE");
      const perms = await this.resolvePermissions(tx, dto.permissionKeys, dto.scope);
      const role = await tx.role.create({ data: { key: dto.key, name: dto.name, description: dto.description ?? null, scope: dto.scope, isSystem: false, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } } });
      await this.audit.record({ eventType: "admin.role.created", entityLabel: role.key, metadata: { roleId: role.id, scope: dto.scope, permissions: perms.map((p) => p.key) } }, tx);
      return role;
    });
  }

  async setRolePermissions(actor: Actor, roleId: string, keys: string[], reason: string) {
    await this.db.tx(async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
      if (!role) throw new NotFoundError("Role");
      if (role.key === ROLE_KEYS.SYSTEM_ADMIN) throw new BusinessRuleError("The system administrator role always holds every permission");
      const perms = await this.resolvePermissions(tx, keys, role.scope);
      const before = role.permissions.map((p) => p.permission.key).sort();
      await tx.rolePermission.deleteMany({ where: { roleId, permissionId: { notIn: perms.map((p) => p.id) } } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })), skipDuplicates: true });
      await this.audit.record({ eventType: "admin.role.permissions_changed", entityLabel: role.key, changes: { permissions: { before, after: perms.map((p) => p.key).sort() } }, reason, metadata: { roleId } }, tx);
    });
    return (await this.roles()).find((r) => r.id === roleId);
  }
}
