import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HetznerFirewallExecutor,
  type HetznerFirewallResolvedConfig,
} from "../../src/adapters/actions/hetzner-firewall/hetzner-firewall-executor.js";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionsRoutes } from "../../src/adapters/http/routes/actions.js";
import { createIpClientsRoutes } from "../../src/adapters/http/routes/ip-clients.js";
import { createProviderCredentialsRoutes } from "../../src/adapters/http/routes/provider-credentials.js";
import { getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { ACTION_AGGREGATE_TYPE, ActionEventName, type ActionFirewallRuleAppliedData } from "../../src/domain/action/events.js";
import { buildDomainEvent } from "../../src/domain/cloud-events.js";
import type { HetznerFirewallRule } from "../../src/domain/action/firewall-rule-selector.js";

const config = loadConfig(process.env);

/**
 * User Story 2 (007-hetzner-firewall-action spec.md): unrelated entries in a shared firewall
 * rule survive every update, and concurrent updates to the same firewall never lose one
 * another's change. Against a real Redis instance (for the advisory lock, research.md §2) with
 * a stateful in-memory fake standing in for the Hetzner Cloud API.
 */
describe("Firewall Rule Update Action lifecycle (User Story 2)", () => {
  const redis = getRedisConnection(config);
  let currentRules: HetznerFirewallRule[];
  const originalFetch = global.fetch;

  beforeEach(() => {
    currentRules = [
      { direction: "in", protocol: "tcp", port: "22", description: "SSH-A", source_ips: ["192.0.2.1/32"] },
      { direction: "in", protocol: "tcp", port: "80", description: "HTTP-B", source_ips: ["192.0.2.2/32"] },
    ];
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        // Artificial delay: without the advisory lock, two concurrent read-modify-write
        // cycles would both read before either writes, guaranteeing a lost update.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({ firewall: { rules: currentRules } });
      }
      const body = JSON.parse(init.body as string) as { rules: HetznerFirewallRule[] };
      currentRules = body.rules;
      return Response.json({ action: { id: 1, status: "success" } });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("only touches this Action's own entry — a static entry and another rule's entry are never modified (FR-006/SC-003)", async () => {
    currentRules[0]!.source_ips = ["192.0.2.1/32", "203.0.113.100/32"]; // 203.0.113.100/32 is a static, manually-added entry

    const executor = new HetznerFirewallExecutor(redis);
    const configA: HetznerFirewallResolvedConfig = {
      apiToken: "test-token",
      accountId: "lifecycle-acct-static",
      firewallId: 9001,
      direction: "in",
      protocol: "tcp",
      port: "22",
      description: "SSH-A",
      previousEntries: {},
    };

    await executor.execute(configA, { ipv4: "198.51.100.1" });
    expect(currentRules[0]!.source_ips).toEqual(["192.0.2.1/32", "203.0.113.100/32", "198.51.100.1/32"]);
    expect(currentRules[1]!.source_ips).toEqual(["192.0.2.2/32"]); // untouched

    // Second run: only the previously-owned entry is replaced; the static entry survives again.
    const configASecondRun: HetznerFirewallResolvedConfig = { ...configA, previousEntries: { ipv4: "198.51.100.1/32" } };
    await executor.execute(configASecondRun, { ipv4: "198.51.100.9" });
    expect(currentRules[0]!.source_ips).toEqual(["192.0.2.1/32", "203.0.113.100/32", "198.51.100.9/32"]);
  });

  it("two Actions on different rules of the same firewall keep their entries independent of each other", async () => {
    const executor = new HetznerFirewallExecutor(redis);
    const configA: HetznerFirewallResolvedConfig = {
      apiToken: "test-token",
      accountId: "lifecycle-acct-independent",
      firewallId: 9002,
      direction: "in",
      protocol: "tcp",
      port: "22",
      description: "SSH-A",
      previousEntries: {},
    };
    const configB: HetznerFirewallResolvedConfig = { ...configA, port: "80", description: "HTTP-B" };

    await executor.execute(configA, { ipv4: "198.51.100.1" });
    await executor.execute(configB, { ipv4: "198.51.100.2" });

    expect(currentRules[0]!.source_ips).toEqual(["192.0.2.1/32", "198.51.100.1/32"]);
    expect(currentRules[1]!.source_ips).toEqual(["192.0.2.2/32", "198.51.100.2/32"]);
  });

  it("prevents lost updates when two Actions update different rules on the same firewall concurrently (FR-009)", async () => {
    const executor = new HetznerFirewallExecutor(redis);
    const configA: HetznerFirewallResolvedConfig = {
      apiToken: "test-token",
      accountId: "lifecycle-acct-concurrent",
      firewallId: 9003,
      direction: "in",
      protocol: "tcp",
      port: "22",
      description: "SSH-A",
      previousEntries: {},
    };
    const configB: HetznerFirewallResolvedConfig = { ...configA, port: "80", description: "HTTP-B" };

    await Promise.all([
      executor.execute(configA, { ipv4: "198.51.100.1" }),
      executor.execute(configB, { ipv4: "198.51.100.2" }),
    ]);

    expect(currentRules[0]!.source_ips).toContain("198.51.100.1/32");
    expect(currentRules[1]!.source_ips).toContain("198.51.100.2/32");
  });
});

/**
 * User Story 4: detaching a Firewall Rule Update Action removes the entry it previously added,
 * best-effort, without ever blocking the detach itself (FR-010/FR-011). Against real Postgres,
 * through the actual HTTP routes.
 */
describe("Firewall Rule Update Action Detach cleanup (User Story 4)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);

  const app = new Hono();
  app.use("*", async (c, next) => {
    const accountId = c.req.header("x-test-account") ?? "";
    c.set("auth", { accountId, roles: [] });
    await accountService.ensureProvisioned(accountId);
    await next();
  });
  app.route("/provider-credentials", createProviderCredentialsRoutes({ config, eventStore }));
  app.route("/ip-clients", createIpClientsRoutes({ config, eventStore, redis, accountService }));
  app.route("/", createActionsRoutes({ config, eventStore, redis }));

  const originalFetch = global.fetch;

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function call(accountId: string, path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, { ...init, headers: { ...init?.headers, "x-test-account": accountId } });
  }

  function postJson(accountId: string, path: string, body: unknown): Promise<Response> {
    return call(accountId, path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const sshRule = { direction: "in", protocol: "tcp", port: "22", description: "SSH", source_ips: ["198.51.100.1/32"] };

  async function attachFirewallAction(): Promise<{ accountId: string; actionId: string }> {
    const accountId = `fw-detach-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const credRes = await postJson(accountId, "/provider-credentials", { provider: "hetzner", label: "Hetzner", secret: "test-token" });
    const { credentialId } = (await credRes.json()) as { credentialId: string };
    const ipClientRes = await postJson(accountId, "/ip-clients", { label: "Test device" });
    const { ipClientId } = (await ipClientRes.json()) as { ipClientId: string };

    global.fetch = vi.fn().mockResolvedValue(Response.json({ firewall: { rules: [sshRule] } }));
    const createRes = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, {
      type: "hetzner_cloud_firewall_rule_update",
      addressFamilies: ["ipv4"],
      config: { providerCredentialId: credentialId, firewallId: 55, direction: "in", protocol: "tcp", port: "22", description: "SSH" },
    });
    const { actionId } = (await createRes.json()) as { actionId: string };

    // Simulate a prior successful execution having recorded the owned entry.
    const data: ActionFirewallRuleAppliedData = { actionId, ipv4: "198.51.100.1/32", appliedAt: new Date().toISOString() };
    const built = buildDomainEvent(config, ACTION_AGGREGATE_TYPE, ActionEventName.FirewallRuleApplied, data);
    await eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      accountId,
      expectedSequenceNumber: 2,
      eventName: ActionEventName.FirewallRuleApplied,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    return { accountId, actionId };
  }

  it("removes the owned entry from the rule on detach", async () => {
    const { accountId, actionId } = await attachFirewallAction();

    let capturedBody: { rules: HetznerFirewallRule[] } | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") return Promise.resolve(Response.json({ firewall: { rules: [sshRule] } }));
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(Response.json({ action: { id: 1, status: "success" } }));
    });

    const detachRes = await call(accountId, `/actions/${actionId}`, { method: "DELETE" });
    expect(detachRes.status).toBe(200);
    expect(await detachRes.json()).toMatchObject({ actionId, status: "detached" });
    expect(capturedBody?.rules[0]?.source_ips).toEqual([]);
  });

  it("still completes the detach even when the cleanup call to Hetzner fails", async () => {
    const { accountId, actionId } = await attachFirewallAction();

    global.fetch = vi.fn().mockRejectedValue(new Error("network unreachable"));

    const detachRes = await call(accountId, `/actions/${actionId}`, { method: "DELETE" });
    expect(detachRes.status).toBe(200);
    expect(await detachRes.json()).toMatchObject({ actionId, status: "detached" });
  });
});
