import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionRegistry } from "../../src/adapters/agent-grpc/session-registry.js";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionsRoutes } from "../../src/adapters/http/routes/actions.js";
import { createDeliveryStatusRoutes, deriveDeliveryStatus } from "../../src/adapters/http/routes/delivery-status.js";
import { createIpClientsRoutes } from "../../src/adapters/http/routes/ip-clients.js";
import { createTraefikProvidersRoutes, deriveConnectionState } from "../../src/adapters/http/routes/traefik-providers.js";
import { getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { TraefikProviderEventName as E } from "../../src/domain/traefik-provider/events.js";
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import { initialTraefikProviderState, type TraefikProviderState } from "../../src/domain/traefik-provider/traefik-provider-aggregate.js";

const config = { ...loadConfig(process.env), agentPublicUrl: "https://agents.example.com" };

const state = (overrides: Partial<TraefikProviderState> = {}): TraefikProviderState => ({
  ...initialTraefikProviderState,
  providerId: "p",
  accountId: "a",
  name: "Nord",
  lastConnectedAt: "2026-01-01T00:00:00Z",
  maxOfflineSeconds: 3600,
  ...overrides,
});
const published = (version: number) => ({ version, contentHash: "h", correlationId: "c", publishedAt: "t" });
const applied = (version: number) => ({ version, correlationId: "c", stale: false, files: [], templates: [], appliedAt: "t" });

describe("deriveDeliveryStatus (research.md §12)", () => {
  it("is applied once the agent applied the published version", () => {
    expect(deriveDeliveryStatus(state({ lastPublished: published(5), lastApplied: applied(5) }), true, true)).toBe("applied");
    expect(deriveDeliveryStatus(state({ lastPublished: published(5), lastApplied: applied(7) }), true, true)).toBe("applied");
  });
  it("is pending while the published version is not applied yet or nothing is published", () => {
    expect(deriveDeliveryStatus(state({ lastPublished: published(6), lastApplied: applied(5) }), true, true)).toBe("pending");
    expect(deriveDeliveryStatus(state(), true, true)).toBe("pending");
  });
  it("is error when the agent reported a failure for the current version", () => {
    const failed = { version: 6, correlationId: "c", reason: "bad yaml", appliedAt: "t" };
    expect(deriveDeliveryStatus(state({ lastPublished: published(6), lastApplied: applied(5), lastApplyError: failed }), true, true)).toBe("error");
  });
  it("ignores an old failure once a newer version is published", () => {
    const failed = { version: 4, correlationId: "c", reason: "bad yaml", appliedAt: "t" };
    expect(deriveDeliveryStatus(state({ lastPublished: published(6), lastApplied: applied(3), lastApplyError: failed }), true, true)).toBe("pending");
  });
  it("is agent_disconnected whenever the agent is not connected, even if the last version was applied", () => {
    expect(deriveDeliveryStatus(state({ lastPublished: published(5), lastApplied: applied(5) }), false, true)).toBe("agent_disconnected");
    expect(deriveDeliveryStatus(state({ lastPresence: "never", lastConnectedAt: null }), false, true)).toBe("agent_disconnected");
  });
  it("is disabled for a disabled action", () => {
    expect(deriveDeliveryStatus(state(), true, false)).toBe("disabled");
  });
});

describe("deriveConnectionState", () => {
  const now = Date.parse("2026-01-01T10:00:00Z");
  it("never_connected, connected, disconnected and stale", () => {
    expect(deriveConnectionState(state({ lastConnectedAt: null }), false, now)).toBe("never_connected");
    expect(deriveConnectionState(state(), true, now)).toBe("connected");
    const off = state({ lastPresence: "disconnected", lastDisconnectedAt: "2026-01-01T09:30:00Z" });
    expect(deriveConnectionState(off, false, now)).toBe("disconnected");
    expect(deriveConnectionState({ ...off, lastDisconnectedAt: "2026-01-01T08:00:00Z" }, false, now)).toBe("stale");
  });
  it("never stale when the agent's maximum offline duration is 'never'", () => {
    const off = state({ maxOfflineSeconds: 0, lastPresence: "disconnected", lastDisconnectedAt: "2020-01-01T00:00:00Z" });
    expect(deriveConnectionState(off, false, now)).toBe("disconnected");
  });
});

describe("GET /ip-clients/:id/delivery-status", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);
  const store = new ProviderStore(eventStore, config);
  const registry = new SessionRegistry();

  const app = new Hono();
  app.use("*", async (c, next) => {
    const accountId = c.req.header("x-test-account") ?? "";
    c.set("auth", { accountId, roles: [] });
    await accountService.ensureProvisioned(accountId);
    await next();
  });
  app.route("/traefik-providers", createTraefikProvidersRoutes({ config, eventStore, store, registry }));
  app.route("/ip-clients", createIpClientsRoutes({ config, eventStore, redis, accountService }));
  app.route("/", createActionsRoutes({ config, eventStore, redis, providerStore: store }));
  app.route("/", createDeliveryStatusRoutes({ eventStore, store, registry }));

  beforeAll(async () => {
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  const send = (accountId: string, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-test-account": accountId },
    });

  it("walks through disconnected -> pending -> applied -> error as the agent reports", async () => {
    const accountId = `status-${Date.now()}`;
    const providerId = ((await (await send(accountId, "POST", "/traefik-providers", { name: "S" })).json()) as { providerId: string }).providerId;
    const ipClientId = ((await (await send(accountId, "POST", "/ip-clients", { label: "d" })).json()) as { ipClientId: string }).ipClientId;
    await send(accountId, "POST", `/ip-clients/${ipClientId}/actions`, { type: "traefik_config_delivery", config: { traefikProviderId: providerId, group: "g" } });

    const status = async () => ((await (await send(accountId, "GET", `/ip-clients/${ipClientId}/delivery-status`)).json()) as { items: Record<string, unknown>[] }).items[0]!;

    expect(await status()).toMatchObject({ providerName: "S", group: "g", status: "agent_disconnected" });

    registry.register({
      providerId,
      accountId,
      connectedAt: "now",
      channel: { sessionId: "s", tokenId: "t", send: () => undefined, close: () => undefined },
    });
    await store.append(accountId, providerId, E.AgentConnected, { sessionId: "s", tokenId: "t", agentVersion: "1", protocolVersion: 1, maxOfflineSeconds: 60, replacedPrevious: false, connectedAt: new Date().toISOString() });
    await store.append(accountId, providerId, E.SnapshotPublished, { contentHash: "h1", groupCount: 1, entryCount: 1, correlationId: "c1", publishedAt: new Date().toISOString() });
    const version = (await store.load(accountId, providerId)).state.lastPublished!.version;
    expect(await status()).toMatchObject({ status: "pending", publishedVersion: version, appliedVersion: null });

    await store.append(accountId, providerId, E.SnapshotApplied, { version, correlationId: "c1", agentVersion: "1", stale: false, files: [], templates: [], appliedAt: new Date().toISOString() });
    expect(await status()).toMatchObject({ status: "applied", appliedVersion: version });

    await store.append(accountId, providerId, E.SnapshotPublished, { contentHash: "h2", groupCount: 1, entryCount: 1, correlationId: "c2", publishedAt: new Date().toISOString() });
    const next = (await store.load(accountId, providerId)).state.lastPublished!.version;
    await store.append(accountId, providerId, E.SnapshotApplyFailed, { version: next, correlationId: "c2", reason: "template broken.yml.tmpl: invalid YAML", appliedAt: new Date().toISOString() });
    expect(await status()).toMatchObject({ status: "error", error: { reason: "template broken.yml.tmpl: invalid YAML" } });

    // The failure is visible on the provider as well (US6-3).
    const list = (await (await send(accountId, "GET", "/traefik-providers")).json()) as { items: { lastError: { reason: string } | null; appliedVersion: number; agentVersion: string; state: string }[] };
    expect(list.items[0]).toMatchObject({ state: "connected", agentVersion: "1", appliedVersion: version, lastError: { reason: "template broken.yml.tmpl: invalid YAML" } });

    registry.unregister(providerId, "s");
    expect(await status()).toMatchObject({ status: "agent_disconnected" });
  });

  it("lists nothing for a device without delivery actions and never leaks other accounts", async () => {
    const accountId = `status-empty-${Date.now()}`;
    const ipClientId = ((await (await send(accountId, "POST", "/ip-clients", { label: "d" })).json()) as { ipClientId: string }).ipClientId;
    const other = `status-other-${Date.now()}`;
    const res = await send(other, "GET", `/ip-clients/${ipClientId}/delivery-status`);
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
    const own = await send(accountId, "GET", `/ip-clients/${ipClientId}/delivery-status`);
    expect(((await own.json()) as { items: unknown[] }).items).toEqual([]);
  });
});
