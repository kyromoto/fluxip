import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET_BYTES = 32;
const SALT_BYTES = 16;

export interface GeneratedCredential {
  /** Plaintext — returned to the caller exactly once, never persisted (research.md §14). */
  secret: string;
  /** Salted hash — the only thing persisted in ip_client aggregate state. */
  hash: string;
}

function digest(secret: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

/**
 * Always system-generated, high-entropy — an IP Client's reporting credential
 * is never user-chosen (research.md §14). A single fast salted hash (not a
 * slow KDF) is sufficient here because the secret already has 256 bits of
 * entropy, unlike a human-chosen password.
 */
export function generateCredential(): GeneratedCredential {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const salt = randomBytes(SALT_BYTES).toString("hex");
  return { secret, hash: `${salt}:${digest(secret, salt)}` };
}

export function verifyCredential(secret: string, storedHash: string): boolean {
  const [salt, expectedDigest] = storedHash.split(":");
  if (!salt || !expectedDigest) return false;

  const candidate = Buffer.from(digest(secret, salt), "hex");
  const expected = Buffer.from(expectedDigest, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
