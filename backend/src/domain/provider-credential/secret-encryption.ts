import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Reversible encryption for Provider Credentials (e.g. a Hetzner API token) —
 * unlike an IP Client's reporting credential, this secret must be decrypted
 * again to call the third-party API, so a one-way hash isn't an option here.
 */
export function encryptSecret(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, "base64");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(ciphertext: string, base64Key: string): string {
  const [ivB64, authTagB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret");
  }
  const key = Buffer.from(base64Key, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
