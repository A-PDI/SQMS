import { createHmac, timingSafeEqual } from "node:crypto";

/** CSRF token bound to the server-side session id (HMAC-SHA256). */
export function csrfTokenFor(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
}

export function csrfTokenValid(secret: string, sessionId: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(csrfTokenFor(secret, sessionId));
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
