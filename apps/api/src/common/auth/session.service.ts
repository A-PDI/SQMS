import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { PERMISSION_DEFINITIONS } from "@sqms/shared";
import type { AppEnv } from "@sqms/server-core";
import { APP_ENV } from "../../infra/tokens";
import { DbService, type Tx } from "../db/db.service";
import type { Actor } from "./actor";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

const EXTERNAL_ALLOWED = new Set(PERMISSION_DEFINITIONS.filter((p) => p.externalAllowed).map((p) => p.key));

/** Server-side session store. Only SHA-256 hashes of session tokens are persisted. */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: DbService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async create(userId: string, ip: string | null, userAgent: string | null, tx?: Tx): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = newOpaqueToken();
    const now = Date.now();
    const absolute = new Date(now + this.env.SESSION_ABSOLUTE_HOURS * 3600_000);
    const idle = new Date(Math.min(now + this.env.SESSION_IDLE_MINUTES * 60_000, absolute.getTime()));
    const client = tx ?? this.db.client;
    const session = await client.authSession.create({
      data: { userId, tokenHash: hashToken(token), idleExpiresAt: idle, absoluteExpiresAt: absolute, ipAddress: ip?.slice(0, 64) ?? null, userAgent: userAgent?.slice(0, 400) ?? null },
    });
    return { token, sessionId: session.id, expiresAt: absolute };
  }

  /** Resolves a presented token to an Actor, or null when the session is invalid, expired, revoked or the user is not active. */
  async resolve(token: string): Promise<Actor | null> {
    if (!token || token.length > 200) return null;
    const now = new Date();
    const session = await this.db.client.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          include: {
            memberships: {
              where: { status: "ACTIVE", organization: { isActive: true, archivedAt: null } },
              include: {
                organization: { include: { supplier: { select: { id: true } } } },
                roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
              },
            },
          },
        },
      },
    });
    if (!session || session.revokedAt || session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) return null;
    const user = session.user;
    if (user.status !== "ACTIVE") return null;
    if (user.userType === "EXTERNAL" && !this.env.SUPPLIER_PORTAL_ENABLED) return null;

    const wantedType = user.userType === "INTERNAL" ? "INTERNAL" : "SUPPLIER";
    const membership = user.memberships.find((m) => m.organization.type === wantedType);
    if (!membership) return null;
    if (wantedType === "SUPPLIER" && !membership.organization.supplier) return null;

    const roles = membership.roles.map((r) => r.role);
    const permissions = new Set<string>();
    for (const role of roles) {
      if (user.userType === "EXTERNAL" && role.scope !== "EXTERNAL") continue;
      for (const rp of role.permissions) {
        // Defense in depth: internal-only permissions are never effective for external accounts.
        if (user.userType === "EXTERNAL" && !EXTERNAL_ALLOWED.has(rp.permission.key)) continue;
        permissions.add(rp.permission.key);
      }
    }

    // Sliding idle expiry, written at most once per minute to limit write load.
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      const idle = new Date(Math.min(now.getTime() + this.env.SESSION_IDLE_MINUTES * 60_000, session.absoluteExpiresAt.getTime()));
      await this.db.client.authSession.update({ where: { id: session.id }, data: { lastSeenAt: now, idleExpiresAt: idle } }).catch(() => undefined);
    }

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      userType: user.userType,
      timezone: user.timezone,
      sessionId: session.id,
      organizationId: membership.organizationId,
      organizationType: membership.organization.type,
      organizationName: membership.organization.name,
      supplierId: membership.organization.supplier?.id ?? null,
      roles: roles.map((r) => r.key),
      permissions,
    };
  }

  async revoke(sessionId: string, reason: string, tx?: Tx): Promise<void> {
    const client = tx ?? this.db.client;
    await client.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string, tx?: Tx): Promise<number> {
    const client = tx ?? this.db.client;
    const res = await client.authSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }
}
