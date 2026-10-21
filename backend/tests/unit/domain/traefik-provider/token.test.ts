import { describe, expect, it } from "vitest";
import { generateAgentToken, hashAgentToken, verifyAgentToken } from "../../../../src/domain/traefik-provider/token.js";

describe("agent token", () => {
  it("generates a prefixed, high-entropy token with a matching hash and last4", () => {
    const token = generateAgentToken();
    expect(token.plaintext).toMatch(/^fxt_[A-Za-z0-9_-]{43}$/);
    expect(token.hash).toBe(hashAgentToken(token.plaintext));
    expect(token.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.last4).toBe(token.plaintext.slice(-4));
    expect(token.hash).not.toContain(token.plaintext);
  });

  it("never repeats", () => {
    expect(generateAgentToken().plaintext).not.toBe(generateAgentToken().plaintext);
  });

  it("verifies only the matching token", () => {
    const token = generateAgentToken();
    expect(verifyAgentToken(token.plaintext, token.hash)).toBe(true);
    expect(verifyAgentToken(`${token.plaintext}x`, token.hash)).toBe(false);
    expect(verifyAgentToken("", token.hash)).toBe(false);
  });

  it("rejects a malformed stored hash instead of throwing", () => {
    expect(verifyAgentToken("fxt_abc", "not-hex")).toBe(false);
  });
});
