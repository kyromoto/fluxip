import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HetznerFirewallExecutor,
  toCidr,
  type HetznerFirewallResolvedConfig,
} from "../../../../src/adapters/actions/hetzner-firewall/hetzner-firewall-executor.js";

const baseConfig: HetznerFirewallResolvedConfig = {
  apiToken: "test-token",
  accountId: "acct-1",
  firewallId: 42,
  direction: "in",
  protocol: "tcp",
  port: "22",
  description: "SSH",
  previousEntries: {},
};

function fakeRedis(): { redis: Redis; setCalls: unknown[][]; evalCalls: unknown[][] } {
  const setCalls: unknown[][] = [];
  const evalCalls: unknown[][] = [];
  const redis = {
    set: vi.fn(async (...args: unknown[]) => {
      setCalls.push(args);
      return "OK";
    }),
    eval: vi.fn(async (...args: unknown[]) => {
      evalCalls.push(args);
      return 1;
    }),
  } as unknown as Redis;
  return { redis, setCalls, evalCalls };
}

function mockHetznerApi(rules: unknown[]): { capturedBody: () => { rules: unknown[] } | undefined; postCalled: () => boolean } {
  let capturedBody: { rules: unknown[] } | undefined;
  let postCalled = false;
  global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (!init || init.method === "GET") {
      return Promise.resolve(Response.json({ firewall: { rules } }));
    }
    postCalled = true;
    capturedBody = JSON.parse(init.body as string);
    return Promise.resolve(Response.json({ action: { id: 1, status: "success" } }));
  });
  return { capturedBody: () => capturedBody, postCalled: () => postCalled };
}

describe("toCidr", () => {
  it("suffixes IPv4 with /32 and IPv6 with /128 (FR-014)", () => {
    expect(toCidr("203.0.113.5", "ipv4")).toBe("203.0.113.5/32");
    expect(toCidr("2001:db8::1", "ipv6")).toBe("2001:db8::1/128");
  });
});

describe("HetznerFirewallExecutor", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("first run appends the new CIDR without removing anything, leaving a static entry untouched (FR-006/FR-007)", async () => {
    const { redis } = fakeRedis();
    const api = mockHetznerApi([
      { direction: "in", protocol: "tcp", port: "22", description: "SSH", source_ips: ["192.0.2.0/24"] },
    ]);

    const executor = new HetznerFirewallExecutor(redis);
    const result = await executor.execute(baseConfig, { ipv4: "203.0.113.5" });

    expect(api.capturedBody()?.rules).toEqual([
      { direction: "in", protocol: "tcp", port: "22", description: "SSH", source_ips: ["192.0.2.0/24", "203.0.113.5/32"] },
    ]);
    expect(result.summary).toContain("ipv4=203.0.113.5/32");
  });

  it("a second run replaces only the previously-owned entry, leaving the static entry untouched (FR-006)", async () => {
    const { redis } = fakeRedis();
    const api = mockHetznerApi([
      {
        direction: "in",
        protocol: "tcp",
        port: "22",
        description: "SSH",
        source_ips: ["192.0.2.0/24", "203.0.113.5/32"],
      },
    ]);

    const config: HetznerFirewallResolvedConfig = { ...baseConfig, previousEntries: { ipv4: "203.0.113.5/32" } };
    const executor = new HetznerFirewallExecutor(redis);
    await executor.execute(config, { ipv4: "203.0.113.9" });

    expect(api.capturedBody()?.rules).toEqual([
      { direction: "in", protocol: "tcp", port: "22", description: "SSH", source_ips: ["192.0.2.0/24", "203.0.113.9/32"] },
    ]);
  });

  it("adding a newly-managed address family to an already-configured Action appends it without touching the family that was already owned (FR-007)", async () => {
    const { redis } = fakeRedis();
    const api = mockHetznerApi([
      {
        direction: "in",
        protocol: "tcp",
        port: "22",
        description: "SSH",
        source_ips: ["192.0.2.0/24", "203.0.113.5/32"],
      },
    ]);

    // ipv4 was already owned by a prior run; ipv6 is being managed for the first time.
    const config: HetznerFirewallResolvedConfig = { ...baseConfig, previousEntries: { ipv4: "203.0.113.5/32" } };
    const executor = new HetznerFirewallExecutor(redis);
    await executor.execute(config, { ipv4: "203.0.113.9", ipv6: "2001:db8::1" });

    expect(api.capturedBody()?.rules).toEqual([
      {
        direction: "in",
        protocol: "tcp",
        port: "22",
        description: "SSH",
        source_ips: ["192.0.2.0/24", "203.0.113.9/32", "2001:db8::1/128"],
      },
    ]);
  });

  it("acquires and releases the advisory lock around the read-modify-write (research.md §2)", async () => {
    const { redis, setCalls, evalCalls } = fakeRedis();
    mockHetznerApi([{ direction: "in", protocol: "tcp", port: "22", description: "SSH", source_ips: [] }]);

    const executor = new HetznerFirewallExecutor(redis);
    await executor.execute(baseConfig, { ipv4: "203.0.113.5" });

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toContain("NX");
    expect(evalCalls).toHaveLength(1);
  });

  it("releases the lock even when the update fails", async () => {
    const { redis, evalCalls } = fakeRedis();
    mockHetznerApi([]); // no rules at all -> no_match

    const executor = new HetznerFirewallExecutor(redis);
    await expect(executor.execute(baseConfig, { ipv4: "203.0.113.5" })).rejects.toThrow();
    expect(evalCalls).toHaveLength(1);
  });

  it("fails the execution and leaves the firewall unmodified when the rule selector no longer matches anything (FR-008)", async () => {
    const { redis } = fakeRedis();
    const api = mockHetznerApi([
      { direction: "in", protocol: "tcp", port: "443", description: "HTTPS", source_ips: [] },
    ]);

    const executor = new HetznerFirewallExecutor(redis);
    await expect(executor.execute(baseConfig, { ipv4: "203.0.113.5" })).rejects.toThrow(/no firewall rule/i);
    expect(api.postCalled()).toBe(false);
  });

  it("fails the execution when the rule selector matches more than one rule (FR-008)", async () => {
    const { redis } = fakeRedis();
    const duplicate = { direction: "in" as const, protocol: "tcp" as const, port: "22", description: "SSH", source_ips: [] };
    const api = mockHetznerApi([duplicate, { ...duplicate }]);

    const executor = new HetznerFirewallExecutor(redis);
    await expect(executor.execute(baseConfig, { ipv4: "203.0.113.5" })).rejects.toThrow(/2 firewall rules/i);
    expect(api.postCalled()).toBe(false);
  });

  it("throws when no IP values are supplied", async () => {
    const { redis } = fakeRedis();
    const executor = new HetznerFirewallExecutor(redis);
    await expect(executor.execute(baseConfig, {})).rejects.toThrow(/No IP values supplied/);
  });
});
