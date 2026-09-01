import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionsRoutes } from "../../src/adapters/http/routes/actions.js";
import { createIpClientsRoutes } from "../../src/adapters/http/routes/ip-clients.js";
import { createProviderCredentialsRoutes } from "../../src/adapters/http/routes/provider-credentials.js";
import { getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { buildDomainEvent } from "../../src/domain/cloud-events.js";
import { ACTION_AGGREGATE_TYPE, ActionEventName, type ActionFirewallRuleAppliedData } from "../../src/domain/action/events.js";

const config = loadConfig(process.env);

/**
 * Contract tests for the Firewall Rule Update Action's config-time validation
 * (contracts/actions-api.md of 007-hetzner-firewall-action, FR-018) — against real Postgres, per
 * this repo's existing testing convention. The Hetzner Cloud API itself is mocked (global.fetch)
 * since these are config-time contract tests, not a live-Hetzner integration test.
 */
describe("Actions API — Firewall Rule Update config-time validation (FR-018)", () => {
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

  function mockFirewallRules(rules: unknown[]): void {
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        return Promise.resolve(Response.json({ firewall: { rules } }));
      }
      return Promise.resolve(Response.json({ action: { id: 1, status: "success" } }));
    });
  }

  async function setup(): Promise<{ accountId: string; ipClientId: string; credentialId: string }> {
    const accountId = `fw-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const credRes = await postJson(accountId, "/provider-credentials", {
      provider: "hetzner",
      label: "Hetzner",
      secret: "test-token",
    });
    const { credentialId } = (await credRes.json()) as { credentialId: string };
    const ipClientRes = await postJson(accountId, "/ip-clients", { label: "Test device" });
    const { ipClientId } = (await ipClientRes.json()) as { ipClientId: string };
    return { accountId, ipClientId, credentialId };
  }

  const sshRule = { direction: "in", protocol: "tcp", port: "22", description: "SSH", source_ips: [] };

  function firewallBody(credentialId: string, overrides: Record<string, unknown> = {}) {
    return {
      type: "hetzner_cloud_firewall_rule_update",
      addressFamilies: ["ipv4"],
      config: {
        providerCredentialId: credentialId,
        firewallId: 42,
        direction: "in",
        protocol: "tcp",
        port: "22",
        description: "SSH",
        ...overrides,
      },
    };
  }

  it("rejects a POST missing required firewall config fields (400), before any event is appended", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    const res = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, {
      type: "hetzner_cloud_firewall_rule_update",
      addressFamilies: ["ipv4"],
      config: { providerCredentialId: credentialId },
    });
    expect(res.status).toBe(400);

    const listRes = await call(accountId, `/ip-clients/${ipClientId}/actions`);
    const { items } = (await listRes.json()) as { items: unknown[] };
    expect(items).toHaveLength(0);
  });

  it("rejects a POST when the firewall can't be reached (400 firewall_not_found)", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    global.fetch = vi.fn().mockResolvedValue(Response.json({ error: { message: "not found" } }, { status: 404 }));

    const res = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, firewallBody(credentialId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "firewall_not_found" });
  });

  it("rejects a POST when the rule selector matches no rule (422 rule_selector_no_match), creating no Action", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    mockFirewallRules([{ direction: "in", protocol: "tcp", port: "443", description: "HTTPS", source_ips: [] }]);

    const res = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, firewallBody(credentialId));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "rule_selector_no_match" });

    const listRes = await call(accountId, `/ip-clients/${ipClientId}/actions`);
    const { items } = (await listRes.json()) as { items: unknown[] };
    expect(items).toHaveLength(0);
  });

  it("rejects a POST when the rule selector matches more than one rule (422 rule_selector_ambiguous)", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    mockFirewallRules([sshRule, { ...sshRule }]);

    const res = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, firewallBody(credentialId));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "rule_selector_ambiguous" });
  });

  it("creates a Firewall Rule Update Action when the selector matches exactly one rule (201)", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    mockFirewallRules([sshRule]);

    const res = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, firewallBody(credentialId));
    expect(res.status).toBe(201);
    const { actionId } = (await res.json()) as { actionId: string };
    expect(actionId).toBeTruthy();

    const listRes = await call(accountId, `/ip-clients/${ipClientId}/actions`);
    const { items } = (await listRes.json()) as { items: { actionId: string; type: string }[] };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ actionId, type: "hetzner_cloud_firewall_rule_update" });
  });

  it("rejects a PUT reconfigure with a non-matching selector (422), leaving the Action's config unchanged", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    mockFirewallRules([sshRule]);
    const createRes = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, firewallBody(credentialId));
    const { actionId } = (await createRes.json()) as { actionId: string };

    mockFirewallRules([{ direction: "in", protocol: "tcp", port: "443", description: "HTTPS", source_ips: [] }]);
    const putRes = await call(accountId, `/actions/${actionId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: { providerCredentialId: credentialId, firewallId: 42, direction: "in", protocol: "tcp", port: "22", description: "SSH" },
      }),
    });
    expect(putRes.status).toBe(422);

    const listRes = await call(accountId, `/ip-clients/${ipClientId}/actions`);
    const { items } = (await listRes.json()) as { items: { actionId: string; addressFamilies: string[] }[] };
    expect(items[0].actionId).toBe(actionId);
  });

  /** Simulates a prior successful execution having recorded an owned entry (normally appended only by action-execution-worker.ts). */
  async function seedFirewallRuleApplied(accountId: string, actionId: string, data: Omit<ActionFirewallRuleAppliedData, "actionId">): Promise<void> {
    const built = buildDomainEvent(config, ACTION_AGGREGATE_TYPE, ActionEventName.FirewallRuleApplied, { actionId, ...data });
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
  }

  it("attempts best-effort removal when a PUT drops a previously-managed address family (FR-017)", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    mockFirewallRules([sshRule]);
    const createRes = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, {
      ...firewallBody(credentialId),
      addressFamilies: ["ipv4", "ipv6"],
    });
    const { actionId } = (await createRes.json()) as { actionId: string };
    await seedFirewallRuleApplied(accountId, actionId, { ipv6: "2001:db8::1/128", appliedAt: new Date().toISOString() });

    let cleanupPosted = false;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") return Promise.resolve(Response.json({ firewall: { rules: [sshRule] } }));
      cleanupPosted = true;
      return Promise.resolve(Response.json({ action: { id: 1, status: "success" } }));
    });

    const putRes = await call(accountId, `/actions/${actionId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addressFamilies: ["ipv4"] }),
    });
    expect(putRes.status).toBe(200);
    expect(cleanupPosted).toBe(true);
  });

  it("still returns 200 from PUT even when the best-effort firewall cleanup itself fails (FR-017/FR-011)", async () => {
    const { accountId, ipClientId, credentialId } = await setup();
    mockFirewallRules([sshRule]);
    const createRes = await postJson(accountId, `/ip-clients/${ipClientId}/actions`, {
      ...firewallBody(credentialId),
      addressFamilies: ["ipv4", "ipv6"],
    });
    const { actionId } = (await createRes.json()) as { actionId: string };
    await seedFirewallRuleApplied(accountId, actionId, { ipv6: "2001:db8::1/128", appliedAt: new Date().toISOString() });

    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") return Promise.resolve(Response.json({ firewall: { rules: [sshRule] } }));
      return Promise.resolve(Response.json({ error: { message: "boom" } }, { status: 500 }));
    });

    const putRes = await call(accountId, `/actions/${actionId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addressFamilies: ["ipv4"] }),
    });
    expect(putRes.status).toBe(200);
  });
});
