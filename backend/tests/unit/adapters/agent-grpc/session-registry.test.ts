import { describe, expect, it, vi } from "vitest";
import { SessionRegistry, type ActiveSession } from "../../../../src/adapters/agent-grpc/session-registry.js";
import type { AgentChannel } from "../../../../src/domain/traefik-provider/agent-channel.js";
import type { CloseReason } from "../../../../src/domain/traefik-provider/agent-protocol.js";

function session(providerId: string, sessionId: string, tokenId = "t1", accountId = "a1"): ActiveSession & { channel: AgentChannel & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } } {
  const channel = { sessionId, tokenId, send: vi.fn(), close: vi.fn() };
  return { providerId, accountId, channel, connectedAt: "now" };
}

const reason: CloseReason = { code: "unauthenticated", message: "revoked", disconnect: "revoked" };

describe("SessionRegistry", () => {
  it("returns the replaced session when a newer one registers (FR-034)", () => {
    const registry = new SessionRegistry();
    const first = session("p1", "s1");
    const second = session("p1", "s2");
    expect(registry.register(first)).toBeUndefined();
    expect(registry.register(second)).toBe(first);
    expect(registry.get("p1")).toBe(second);
  });

  it("does not let a superseded session evict its successor", () => {
    const registry = new SessionRegistry();
    registry.register(session("p1", "s1"));
    registry.register(session("p1", "s2"));
    expect(registry.unregister("p1", "s1")).toBe(false);
    expect(registry.isConnected("p1")).toBe(true);
    expect(registry.unregister("p1", "s2")).toBe(true);
    expect(registry.isConnected("p1")).toBe(false);
  });

  it("pushes only to a live session", () => {
    const registry = new SessionRegistry();
    const s = session("p1", "s1");
    registry.register(s);
    expect(registry.push("p1", { type: "heartbeat", nonce: 1 })).toBe(true);
    expect(s.channel.send).toHaveBeenCalledWith({ type: "heartbeat", nonce: 1 });
    expect(registry.push("other", { type: "heartbeat", nonce: 1 })).toBe(false);
  });

  it("terminates by token only when the session used that token", () => {
    const registry = new SessionRegistry();
    const s = session("p1", "s1", "tokenA");
    registry.register(s);
    expect(registry.terminateByToken("p1", "tokenB", reason)).toBe(0);
    expect(s.channel.close).not.toHaveBeenCalled();
    expect(registry.terminateByToken("p1", "tokenA", reason)).toBe(1);
    expect(s.channel.close).toHaveBeenCalledWith(reason);
  });

  it("terminates by provider, account and all", () => {
    const registry = new SessionRegistry();
    const a = session("p1", "s1", "t", "acc1");
    const b = session("p2", "s2", "t", "acc1");
    const c = session("p3", "s3", "t", "acc2");
    [a, b, c].forEach((s) => registry.register(s));
    expect(registry.terminateByProvider("p1", reason)).toBe(1);
    expect(registry.terminateByAccount("acc1", reason)).toBe(2);
    expect(c.channel.close).not.toHaveBeenCalled();
    expect(registry.terminateAll(reason)).toBe(3);
  });
});
