import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionRegistry } from "../../src/adapters/agent-grpc/session-registry.js";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionRunRoutes } from "../../src/adapters/http/routes/action-run.js";
import { createActionsRoutes } from "../../src/adapters/http/routes/actions.js";
import { createIpClientsRoutes } from "../../src/adapters/http/routes/ip-clients.js";
import { createTraefikProvidersRoutes } from "../../src/adapters/http/routes/traefik-providers.js";
import { createActionExecutionQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import type { SnapshotScheduler } from "../../src/domain/traefik-provider/snapshot-scheduler.js";

const config = { ...loadConfig(process.env), agentPublicUrl: "https://agents.example.com" };

/** Contract tests for the Traefik delivery action (contracts/management-api.md "Aktion"), against real Postgres/Redis. */
describe("Traefik delivery action API", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);
  const store = new ProviderStore(eventStore, config);
  const registry = new SessionRegistry();
  const actionExecutionQueue = createActionExecutionQueue(config);
  const scheduled: { accountId: string; providerIds: string[] }[] = [];
  const snapshots: SnapshotScheduler = {
    async schedule(accountId, providerIds) {
      scheduled.push({ accountId, providerIds });
    },
  };

  const app = new Hono();
  app.use("*", async (c, next) => {
    const accountId = c.req.header("x-test-account") ?? "";
    c.set("auth", { accountId, roles: [] });
    await accountService.ensureProvisioned(accountId);
    await next();
  });
  app.route("/traefik-providers", createTraefikProvidersRoutes({ config, eventStore, store, registry }));
  app.route("/ip-clients", createIpClientsRoutes({ config, eventStore, redis, accountService, snapshots }));
  app.route("/", createActionsRoutes({ config, eventStore, redis, providerStore: store, snapshots }));
  app.route("/", createActionRunRoutes({ eventStore, actionExecutionQueue }));

  beforeAll(async () => {
    await runMigrations(pool);
  });
  afterAll(async () => {
    await actionExecutionQueue.close();
    await pool.end();
  });

  const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  function call(accountId: string, path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, { ...init, headers: { "content-type": "application/json", ...init?.headers, "x-test-account": accountId } });
  }
  const send = (accountId: string, method: string, path: string, body?: unknown) =>
    call(accountId, path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  async function provider(accountId: string, name = "Nord"): Promise<string> {
    return ((await (await send(accountId, "POST", "/traefik-providers", { name })).json()) as { providerId: string }).providerId;
  }
  async function device(accountId: string, label = "dev"): Promise<string> {
    return ((await (await send(accountId, "POST", "/ip-clients", { label })).json()) as { ipClientId: string }).ipClientId;
  }
  const attach = (accountId: string, ipClientId: string, config: unknown) =>
    send(accountId, "POST", `/ip-clients/${ipClientId}/actions`, { type: "traefik_config_delivery", config });

  it("attaches a delivery action; address families are implied and the schedule is requested (US2-1)", async () => {
    const accountId = unique("attach");
    const providerId = await provider(accountId);
    const ipClientId = await device(accountId);
    scheduled.length = 0;

    const res = await attach(accountId, ipClientId, { traefikProviderId: providerId, group: "admin-allowlist" });
    expect(res.status).toBe(201);
    const { actionId } = (await res.json()) as { actionId: string };
    expect(scheduled).toContainEqual({ accountId, providerIds: [providerId] });

    const list = (await (await call(accountId, `/ip-clients/${ipClientId}/actions`)).json()) as { items: Record<string, unknown>[] };
    expect(list.items).toEqual([
      expect.objectContaining({
        actionId,
        type: "traefik_config_delivery",
        addressFamilies: ["ipv4", "ipv6"],
        config: { traefikProviderId: providerId, group: "admin-allowlist" },
        status: "enabled",
      }),
    ]);

    const detail = (await (await call(accountId, `/traefik-providers/${providerId}`)).json()) as { usedBy: unknown[]; groups: string[]; actionCount: number };
    expect(detail.actionCount).toBe(1);
    expect(detail.groups).toEqual(["admin-allowlist"]);
    expect(detail.usedBy).toEqual([expect.objectContaining({ actionId, ipClientId, group: "admin-allowlist", status: "enabled" })]);
  });

  it("rejects providers of other accounts and unknown ones with 404 (US2-6, FR-004)", async () => {
    const owner = unique("owner");
    const stranger = unique("stranger");
    const foreignProvider = await provider(owner);
    const ipClientId = await device(stranger);
    expect((await attach(stranger, ipClientId, { traefikProviderId: foreignProvider, group: "g" })).status).toBe(404);
    expect((await attach(stranger, ipClientId, { traefikProviderId: "nope", group: "g" })).status).toBe(404);
    expect((await attach(stranger, ipClientId, { group: "g" })).status).toBe(422);
  });

  it("validates the group", async () => {
    const accountId = unique("group");
    const providerId = await provider(accountId);
    const ipClientId = await device(accountId);
    for (const group of ["", "Admin", "has space", "-leading", "x".repeat(64), 5]) {
      const res = await attach(accountId, ipClientId, { traefikProviderId: providerId, group });
      expect(res.status, `group ${JSON.stringify(group)}`).toBe(422);
    }
    expect((await attach(accountId, ipClientId, { traefikProviderId: providerId, group: "a.b_c-1" })).status).toBe(201);
  });

  it("allows one action per device and provider, but several providers per device (FR-011)", async () => {
    const accountId = unique("once");
    const p1 = await provider(accountId, "P1");
    const p2 = await provider(accountId, "P2");
    const ipClientId = await device(accountId);
    expect((await attach(accountId, ipClientId, { traefikProviderId: p1, group: "g" })).status).toBe(201);
    const dup = await attach(accountId, ipClientId, { traefikProviderId: p1, group: "other" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "delivery_action_exists" });
    expect((await attach(accountId, ipClientId, { traefikProviderId: p2, group: "g" })).status).toBe(201);

    // A different device may use the same provider and group.
    const second = await device(accountId, "second");
    expect((await attach(accountId, second, { traefikProviderId: p1, group: "g" })).status).toBe(201);
  });

  it("does not attach to unknown devices or other accounts' devices", async () => {
    const accountId = unique("dev");
    const providerId = await provider(accountId);
    expect((await attach(accountId, "no-such-device", { traefikProviderId: providerId, group: "g" })).status).toBe(404);
    const foreign = await device(unique("foreign"));
    expect((await attach(accountId, foreign, { traefikProviderId: providerId, group: "g" })).status).toBe(404);
  });

  it("moves an action to another group or provider and schedules both providers (US2-4)", async () => {
    const accountId = unique("move");
    const p1 = await provider(accountId, "P1");
    const p2 = await provider(accountId, "P2");
    const ipClientId = await device(accountId);
    const { actionId } = (await (await attach(accountId, ipClientId, { traefikProviderId: p1, group: "g" })).json()) as { actionId: string };

    scheduled.length = 0;
    const res = await send(accountId, "PUT", `/actions/${actionId}`, { config: { traefikProviderId: p2, group: "h" } });
    expect(res.status).toBe(200);
    expect(scheduled.flatMap((s) => s.providerIds).sort()).toEqual([p1, p2].sort());

    const list = (await (await call(accountId, `/ip-clients/${ipClientId}/actions`)).json()) as { items: { config: unknown }[] };
    expect(list.items[0]?.config).toEqual({ traefikProviderId: p2, group: "h" });

    // The device now delivers to P2; a second action for P3 is fine, but moving it onto P2 is refused.
    const p3 = await provider(accountId, "P3");
    const second = (await (await attach(accountId, ipClientId, { traefikProviderId: p3, group: "g" })).json()) as { actionId: string };
    expect(second.actionId).toBeDefined();
    const clash = await send(accountId, "PUT", `/actions/${second.actionId}`, { config: { traefikProviderId: p2, group: "g" } });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: "delivery_action_exists" });
    // Re-saving an action with its own provider is not a clash.
    expect((await send(accountId, "PUT", `/actions/${second.actionId}`, { config: { traefikProviderId: p3, group: "renamed" } })).status).toBe(200);
  });

  it("schedules on enable, disable and detach, and refuses a manual run (US2-4)", async () => {
    const accountId = unique("life");
    const providerId = await provider(accountId);
    const ipClientId = await device(accountId);
    const { actionId } = (await (await attach(accountId, ipClientId, { traefikProviderId: providerId, group: "g" })).json()) as { actionId: string };

    for (const [method, path] of [
      ["POST", `/actions/${actionId}/disable`],
      ["POST", `/actions/${actionId}/enable`],
    ] as const) {
      scheduled.length = 0;
      expect((await send(accountId, method, path)).status).toBe(200);
      expect(scheduled).toContainEqual({ accountId, providerIds: [providerId] });
    }

    const run = await send(accountId, "POST", `/actions/${actionId}/run`);
    expect(run.status).toBe(409);
    expect(await run.json()).toMatchObject({ error: "not_runnable" });

    scheduled.length = 0;
    expect((await send(accountId, "DELETE", `/actions/${actionId}`)).status).toBe(200);
    expect(scheduled).toContainEqual({ accountId, providerIds: [providerId] });
    const detail = (await (await call(accountId, `/traefik-providers/${providerId}`)).json()) as { actionCount: number };
    expect(detail.actionCount).toBe(0);
  });

  it("schedules the providers of a device when it is disabled, enabled or removed (FR-013)", async () => {
    const accountId = unique("device");
    const providerId = await provider(accountId);
    const ipClientId = await device(accountId);
    await attach(accountId, ipClientId, { traefikProviderId: providerId, group: "g" });

    for (const [method, path] of [
      ["POST", `/ip-clients/${ipClientId}/disable`],
      ["POST", `/ip-clients/${ipClientId}/enable`],
      ["DELETE", `/ip-clients/${ipClientId}`],
    ] as const) {
      scheduled.length = 0;
      expect((await send(accountId, method, path)).status, path).toBe(200);
      expect(scheduled, path).toContainEqual({ accountId, providerIds: [providerId] });
    }
  });

  it("blocks deleting a provider that actions still use, and lists them (US7-3, FR-006)", async () => {
    const accountId = unique("block");
    const providerId = await provider(accountId);
    const ipClientId = await device(accountId);
    const { actionId } = (await (await attach(accountId, ipClientId, { traefikProviderId: providerId, group: "g" })).json()) as { actionId: string };

    const blocked = await send(accountId, "DELETE", `/traefik-providers/${providerId}`);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "traefik_provider_in_use", usedBy: [{ actionId, ipClientId, group: "g" }] });

    await send(accountId, "DELETE", `/actions/${actionId}`);
    expect((await send(accountId, "DELETE", `/traefik-providers/${providerId}`)).status).toBe(204);
  });
});
