import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "fxt_";

export interface GeneratedAgentToken {
  /** Shown to the user exactly once. */
  plaintext: string;
  hash: string;
  last4: string;
}

export function hashAgentToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** 32 random bytes → high entropy, so a fast hash is sufficient (research.md §9). */
export function generateAgentToken(): GeneratedAgentToken {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashAgentToken(plaintext), last4: plaintext.slice(-4) };
}

/** Constant-time comparison of a presented token against a stored hash. */
export function verifyAgentToken(presented: string, storedHash: string): boolean {
  const presentedHash = Buffer.from(hashAgentToken(presented), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (presentedHash.length !== expected.length) return false;
  return timingSafeEqual(presentedHash, expected);
}
