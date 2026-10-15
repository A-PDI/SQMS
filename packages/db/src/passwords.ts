import argon2 from "argon2";

/** Argon2id parameters (OWASP Password Storage Cheat Sheet minimum: m=19 MiB, t=2, p=1). */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, PASSWORD_HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, {
    memoryCost: PASSWORD_HASH_OPTIONS.memoryCost,
    timeCost: PASSWORD_HASH_OPTIONS.timeCost,
    parallelism: PASSWORD_HASH_OPTIONS.parallelism,
  });
}

/** Basic password policy: length bounds and not trivially composed of one character class. */
export function passwordPolicyViolation(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) return "Password must contain at least three of: lowercase, uppercase, digits, symbols";
  return null;
}
