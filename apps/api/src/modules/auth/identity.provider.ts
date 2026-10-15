import { Injectable } from "@nestjs/common";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "@sqms/db";
import { DbService } from "../../common/db/db.service";

export type AuthenticationResult =
  | { ok: true; userId: string; userType: "INTERNAL" | "EXTERNAL"; mfaRequired: boolean }
  | { ok: false; reason: "invalid_credentials" | "locked" | "disabled" | "not_activated"; userId?: string };

/**
 * Replaceable identity interface. Phase 1 uses local password authentication; future providers (Microsoft Entra ID
 * / OIDC, SAML) implement the same contract and link accounts through user_identities.
 */
export interface IdentityProvider {
  readonly name: string;
  authenticate(email: string, password: string, policy: { maxFailures: number; lockoutMinutes: number }): Promise<AuthenticationResult>;
}

export const IDENTITY_PROVIDER = Symbol("IDENTITY_PROVIDER");

// Pre-computed Argon2id hash used to equalize timing when the account does not exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equalization-placeholder"));

@Injectable()
export class LocalPasswordIdentityProvider implements IdentityProvider {
  readonly name = "local";

  constructor(private readonly db: DbService) {}

  async authenticate(email: string, password: string, policy: { maxFailures: number; lockoutMinutes: number }): Promise<AuthenticationResult> {
    const user = await this.db.client.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !user.passwordHash) {
      await verifyPassword(await getDummyHash(), password);
      return { ok: false, reason: user ? "not_activated" : "invalid_credentials", userId: user?.id };
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await verifyPassword(await getDummyHash(), password);
      return { ok: false, reason: "locked", userId: user.id };
    }
    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= policy.maxFailures;
      await this.db.client.user.update({
        where: { id: user.id },
        data: lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + policy.lockoutMinutes * 60_000) } : { failedLoginCount: failures },
      });
      return { ok: false, reason: lock ? "locked" : "invalid_credentials", userId: user.id };
    }
    if (user.status === "DISABLED") return { ok: false, reason: "disabled", userId: user.id };
    if (user.status !== "ACTIVE") return { ok: false, reason: "not_activated", userId: user.id };
    const data: { failedLoginCount: number; lockedUntil: null; lastLoginAt: Date; passwordHash?: string } = { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() };
    if (passwordNeedsRehash(user.passwordHash)) data.passwordHash = await hashPassword(password);
    await this.db.client.user.update({ where: { id: user.id }, data });
    return { ok: true, userId: user.id, userType: user.userType, mfaRequired: user.mfaRequired };
  }
}
