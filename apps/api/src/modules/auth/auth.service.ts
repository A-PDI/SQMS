import { Inject, Injectable } from "@nestjs/common";
import { hashPassword, passwordPolicyViolation, verifyPassword } from "@sqms/db";
import type { AppEnv } from "@sqms/server-core";
import { APP_ENV } from "../../infra/tokens";
import type { Actor } from "../../common/auth/actor";
import { csrfTokenFor } from "../../common/auth/csrf";
import { RateLimiter } from "../../common/auth/rate-limiter";
import { hashToken, newOpaqueToken, SessionService } from "../../common/auth/session.service";
import { AuditService } from "../../common/audit/audit.service";
import { DbService } from "../../common/db/db.service";
import { BusinessRuleError, ForbiddenError, NotFoundError, RateLimitedError, UnauthorizedError } from "../../common/errors/app-errors";
import { NotificationService } from "../../common/services/notification.service";
import { SettingsService } from "../../common/services/settings.service";
import { IDENTITY_PROVIDER, type IdentityProvider } from "./identity.provider";

const GENERIC_LOGIN_FAILURE = "Invalid email or password, or the account is locked. Try again later.";

export interface LoginResult {
  token: string;
  expiresAt: Date;
  csrfToken: string;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async login(emailRaw: string, password: string, ip: string | null, userAgent: string | null): Promise<LoginResult> {
    const email = emailRaw.trim().toLowerCase();
    const ipAllowed = await this.limiter.hit(`login:ip:${ip ?? "unknown"}`, this.env.LOGIN_RATE_LIMIT_PER_MINUTE, 60);
    const emailAllowed = await this.limiter.hit(`login:email:${email}`, this.env.LOGIN_RATE_LIMIT_PER_MINUTE, 60);
    if (!ipAllowed || !emailAllowed) {
      await this.audit.record({ eventType: "auth.login.rate_limited", outcome: "DENIED", actorEmail: email });
      throw new RateLimitedError("Too many login attempts. Please wait a minute and try again.");
    }

    const result = await this.identity.authenticate(email, password, { maxFailures: this.env.LOGIN_MAX_FAILURES, lockoutMinutes: this.env.LOGIN_LOCKOUT_MINUTES });
    if (!result.ok) {
      await this.audit.record({
        eventType: result.reason === "locked" ? "auth.login.locked" : "auth.login.failed",
        outcome: "FAILURE",
        actorEmail: email,
        actorUserId: result.userId,
        entityType: result.userId ? "USER" : undefined,
        entityId: result.userId,
        metadata: { reason: result.reason, provider: this.identity.name },
      });
      throw new UnauthorizedError(GENERIC_LOGIN_FAILURE);
    }

    if (result.userType === "EXTERNAL") {
      // Phase 1 hard gate. In production, enabling the portal also requires an MFA provider (validated at startup).
      if (!this.env.SUPPLIER_PORTAL_ENABLED) {
        await this.audit.record({ eventType: "auth.login.denied_portal_disabled", outcome: "DENIED", actorEmail: email, actorUserId: result.userId, entityType: "USER", entityId: result.userId });
        throw new ForbiddenError("Supplier portal access is not enabled.");
      }
    }

    const session = await this.sessions.create(result.userId, ip, userAgent);
    await this.audit.record({ eventType: "auth.login.succeeded", actorEmail: email, actorUserId: result.userId, entityType: "USER", entityId: result.userId, metadata: { sessionId: session.sessionId, provider: this.identity.name } });
    await this.limiter.reset(`login:email:${email}`);
    return { token: session.token, expiresAt: session.expiresAt, csrfToken: csrfTokenFor(this.env.CSRF_SECRET, session.sessionId), userId: result.userId };
  }

  async logout(actor: Actor): Promise<void> {
    await this.sessions.revoke(actor.sessionId, "logout");
    await this.audit.record({ eventType: "auth.logout", entityType: "USER", entityId: actor.userId });
  }

  async me(actor: Actor) {
    const [user, branding] = await Promise.all([
      this.db.client.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { id: true, email: true, displayName: true, timezone: true, jobTitle: true, department: true, phone: true, lastLoginAt: true } }),
      this.settings.get<Record<string, unknown>>("branding", {}),
    ]);
    return {
      ...user,
      userType: actor.userType,
      organization: { id: actor.organizationId, name: actor.organizationName, type: actor.organizationType },
      supplierId: actor.supplierId,
      roles: actor.roles,
      permissions: [...actor.permissions].sort(),
      csrfToken: csrfTokenFor(this.env.CSRF_SECRET, actor.sessionId),
      features: { supplierPortal: this.env.SUPPLIER_PORTAL_ENABLED, carbonZappMode: this.env.CARBONZAPP_MODE, injectorSheetMode: this.env.INJECTOR_SHEET_MODE },
      branding,
    };
  }

  async updateProfile(actor: Actor, input: { displayName?: string; timezone?: string; jobTitle?: string; phone?: string }) {
    if (input.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
      } catch {
        throw new BusinessRuleError("Unknown time zone");
      }
    }
    const before = await this.db.client.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const updated = await this.db.client.user.update({ where: { id: actor.userId }, data: input });
    await this.audit.record({
      eventType: "user.profile.updated",
      entityType: "USER",
      entityId: actor.userId,
      changes: Object.fromEntries(Object.keys(input).filter((k) => (before as Record<string, unknown>)[k] !== (updated as Record<string, unknown>)[k]).map((k) => [k, { before: (before as Record<string, unknown>)[k], after: (updated as Record<string, unknown>)[k] }])),
    });
    return this.me(actor);
  }

  async listSessions(actor: Actor) {
    const rows = await this.db.client.authSession.findMany({
      where: { userId: actor.userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() }, idleExpiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, ipAddress: true, userAgent: true, idleExpiresAt: true, absoluteExpiresAt: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === actor.sessionId }));
  }

  async revokeSession(actor: Actor, sessionId: string): Promise<void> {
    const s = await this.db.client.authSession.findFirst({ where: { id: sessionId, userId: actor.userId } });
    if (!s) throw new NotFoundError("Session");
    await this.sessions.revoke(sessionId, "revoked_by_user");
    await this.audit.record({ eventType: "auth.session.revoked", entityType: "USER", entityId: actor.userId, metadata: { sessionId } });
  }

  async revokeOtherSessions(actor: Actor): Promise<number> {
    const count = await this.sessions.revokeAllForUser(actor.userId, "revoked_by_user", actor.sessionId);
    await this.audit.record({ eventType: "auth.session.revoked_others", entityType: "USER", entityId: actor.userId, metadata: { count } });
    return count;
  }

  async changePassword(actor: Actor, current: string, next: string): Promise<void> {
    const violation = passwordPolicyViolation(next);
    if (violation) throw new BusinessRuleError(violation);
    const user = await this.db.client.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
      await this.audit.record({ eventType: "auth.password.change_failed", outcome: "FAILURE", entityType: "USER", entityId: actor.userId });
      throw new BusinessRuleError("Current password is incorrect");
    }
    await this.db.tx(async (tx) => {
      await tx.user.update({ where: { id: actor.userId }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
      await this.sessions.revokeAllForUser(actor.userId, "password_changed", actor.sessionId, tx);
      await this.audit.record({ eventType: "auth.password.changed", entityType: "USER", entityId: actor.userId }, tx);
    });
  }

  /** Always succeeds from the caller's perspective to avoid account enumeration. */
  async requestPasswordReset(emailRaw: string, ip: string | null): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    if (!(await this.limiter.hit(`pwreset:${email}`, 3, 3600)) || !(await this.limiter.hit(`pwreset:ip:${ip ?? "unknown"}`, 20, 3600))) {
      await this.audit.record({ eventType: "auth.password_reset.rate_limited", outcome: "DENIED", actorEmail: email });
      return;
    }
    const user = await this.db.client.user.findUnique({ where: { email } });
    if (!user || user.status !== "ACTIVE" || (user.userType === "EXTERNAL" && !this.env.SUPPLIER_PORTAL_ENABLED)) {
      await this.audit.record({ eventType: "auth.password_reset.requested_unknown", outcome: "FAILURE", actorEmail: email });
      return;
    }
    const token = newOpaqueToken();
    const branding = await this.settings.get<{ productName?: string }>("branding", {});
    await this.db.tx(async (tx, after) => {
      await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), requestIp: ip?.slice(0, 64) ?? null } });
      const link = `${this.env.APP_BASE_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
      await this.notifications.sendDirectEmail(tx, after, {
        to: user.email,
        subject: `[${branding.productName ?? "SQMS"}] Password reset`,
        body: `A password reset was requested for your account.\n\nReset your password (valid for 1 hour): ${link}\n\nIf you did not request this, you can ignore this email.`,
      });
      await this.audit.record({ eventType: "auth.password_reset.requested", entityType: "USER", entityId: user.id, actorEmail: email }, tx);
    });
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const violation = passwordPolicyViolation(newPassword);
    if (violation) throw new BusinessRuleError(violation);
    const record = await this.db.client.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!record || record.usedAt || record.expiresAt <= new Date() || record.user.status !== "ACTIVE") {
      throw new BusinessRuleError("This reset link is invalid or has expired");
    }
    await this.db.tx(async (tx) => {
      const used = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw new BusinessRuleError("This reset link is invalid or has expired");
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await this.sessions.revokeAllForUser(record.userId, "password_reset", undefined, tx);
      await this.audit.record({ eventType: "auth.password_reset.completed", entityType: "USER", entityId: record.userId, actorUserId: record.userId, actorEmail: record.user.email }, tx);
    });
  }

  private async loadInvitation(token: string) {
    const inv = await this.db.client.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: true, roles: { include: { role: true } } } });
    if (!inv || inv.status !== "PENDING" || inv.expiresAt <= new Date()) throw new BusinessRuleError("This invitation is invalid or has expired");
    if (inv.organization.type === "SUPPLIER" && !this.env.SUPPLIER_PORTAL_ENABLED) throw new ForbiddenError("Supplier portal access is not enabled.");
    return inv;
  }

  async describeInvitation(token: string) {
    const inv = await this.loadInvitation(token);
    return { email: inv.email, displayName: inv.displayName, organizationName: inv.organization.name, roles: inv.roles.map((r) => r.role.name), expiresAt: inv.expiresAt };
  }

  async acceptInvitation(token: string, password: string, displayName?: string): Promise<void> {
    const violation = passwordPolicyViolation(password);
    if (violation) throw new BusinessRuleError(violation);
    const inv = await this.loadInvitation(token);
    const passwordHash = await hashPassword(password);
    await this.db.tx(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new BusinessRuleError("This invitation is invalid or has expired");
      const userType = inv.organization.type === "INTERNAL" ? "INTERNAL" : "EXTERNAL";
      let user = await tx.user.findUnique({ where: { email: inv.email } });
      if (user) {
        if (user.userType !== userType) throw new BusinessRuleError("This email is already registered with a different account type");
        if (user.passwordHash) throw new BusinessRuleError("An account already exists for this email. Ask an administrator to grant access.");
        user = await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date(), status: "ACTIVE", displayName: displayName ?? user.displayName } });
      } else {
        user = await tx.user.create({
          data: { email: inv.email, displayName: displayName ?? inv.displayName ?? inv.email, userType, status: "ACTIVE", passwordHash, passwordChangedAt: new Date(), mfaRequired: userType === "EXTERNAL" },
        });
      }
      const membership = await tx.organizationMembership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: inv.organizationId } },
        update: { status: "ACTIVE" },
        create: { userId: user.id, organizationId: inv.organizationId },
      });
      await tx.membershipRole.createMany({ data: inv.roles.map((r) => ({ membershipId: membership.id, roleId: r.roleId, grantedById: inv.invitedById })), skipDuplicates: true });
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedUserId: user.id } });
      await this.audit.record(
        { eventType: "auth.invitation.accepted", entityType: "USER", entityId: user.id, actorUserId: user.id, actorEmail: user.email, metadata: { invitationId: inv.id, organizationId: inv.organizationId, roles: inv.roles.map((r) => r.role.key) } },
        tx,
      );
    });
  }
}
