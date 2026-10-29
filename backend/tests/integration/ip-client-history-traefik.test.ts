import { Hono } from "hono";
import { Pool } from "pg";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SnapshotCoordinator } from "../../src/adapters/agent-grpc/snapshot-coordinator.js";
import { SessionRegistry } from "../../src/adapters/agent-grpc/session-registry.js";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createIpClientHistoryRoutes } from "../../src/adapters/http/routes/ip-client-history.js";
import { createDebounceWorker } from "../../src/adapters/queue-bullmq/debounce-worker.js";
import { createActionExecutionQueue, createDebounceQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { SnapshotPublisher } from "../../src/adapters/queue-bullmq/snapshot-publisher.js";
import { loadConfig } from "../../src/config/env.js";
import { ACTION_AGGREGATE_TYPE, ActionEventName } from "../../src/domain/action/events.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName } from "../../src/domain/ip-client/events.js";
import { TraefikProviderEventName as E } from "../../src/domain/traefik-provider/events.js";
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import { TraefikWorld, waitFor } from "../helpers/traefik-world.js";

const config = loadConfig({
  ...process.env,
  BACKEND_IP_CLIENT_DEBOUNCE_MS: "150",
  BACKEND_AGENT_SNAPSHOT_COALESCE_MS: "400",
});

interface Delivery {
  actionId: string;
  providerName: string | null;
  group: string;
  kind: "delivered" | "combined";
  stage: "published" | "applied" | "failed" | null;
  at: string | null;
  error: string | null;
}
interface HistoryItem {
  ipChangedEventId: string;
  executions: unknown[];
  deliveries: Delivery[];
}

describe("GET /ip-clients/:id/history — Traefik deliveries (specs/009)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const store = new ProviderStore(eventStore, config);
  const registry = new SessionRegistry();
  const publisher = new SnapshotPublisher({ config, eventStore, store });
  const coordinator = new SnapshotCoordinator({ config, publisher, registry });
  const world = new TraefikWorld(config, eventStore, store);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  let debounceWorker: ReturnType<typeof createDebounceWorker>;

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth", { accountId: c.req.header("x-test-account") ?? "", roles: [] });
    await next();
  });
  app.route("/", createIpClientHistoryRoutes({ eventStore }));

  beforeAll(async () => {
    await runMigrations(pool);
    debounceWorker = createDebounceWorker({ config, eventStore, redis, actionExecutionQueue, snapshots: coordinator });
  });
  afterAll(async () => {
    coordinator.stop();
    await debounceWorker.close();
    await debounceQueue.close();
    await actionExecutionQueue.close();
    await pool.end();
  });

  const history = async (accountId: string, ipClientId: string): Promise<{ status: number; items: HistoryItem[] }> => {
    const res = await app.request(`/ip-clients/${ipClientId}/history`, { headers: { "x-test-account": accountId } });
    const body = (await res.json()) as { items?: HistoryItem[] };
    return { status: res.status, items: body.items ?? [] };
  };

  /** Writes an `ip_changed` event as the debounce worker would and returns its id. */
  async function ipChanged(accountId: string, ipClientId: string, ip: string): Promise<string> {
    const events = await eventStore.readStream({ accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId });
    const id = ulid();
    await eventStore.append({
      id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId,
      expectedSequenceNumber: events.length + 1,
      eventName: IpClientEventName.IpChanged,
      type: "t",
      source: "s",
      time: new Date().toISOString(),
      data: { newIPv4: ip, settledAt: new Date().toISOString() },
    });
    return id;
  }

  const publish = async (accountId: string, providerId: string, correlationId: string, extra: Record<string, unknown> = {}) => {
    const event = await store.append(accountId, providerId, E.SnapshotPublished, {
      contentHash: ulid(),
      groupCount: 1,
      entryCount: 1,
      correlationId,
      publishedAt: new Date().toISOString(),
      ...extra,
    });
    return event.sequenceNumber;
  };

  it("shows published, applied and failed deliveries next to the unchanged executions (US1)", async () => {
    const accountId = `hist-${Date.now()}`;
    const { providerId } = await world.provider(accountId, "Nord");
    const device = await world.device(accountId, "home");
    const actionId = await world.deliveryAction(accountId, device, providerId, "home");

    const c1 = await ipChanged(accountId, device, "203.0.113.1");
    const c2 = await ipChanged(accountId, device, "203.0.113.2");
    const c3 = await ipChanged(accountId, device, "203.0.113.3");

    const v1 = await publish(accountId, providerId, c1);
    await store.append(accountId, providerId, E.SnapshotApplied, { version: v1, correlationId: c1, agentVersion: "1", stale: false, files: [], templates: [], appliedAt: "applied-1" });
    const v2 = await publish(accountId, providerId, c2);
    await store.append(accountId, providerId, E.SnapshotApplyFailed, { version: v2, correlationId: c2, reason: "template broken", appliedAt: "failed-2" });
    await publish(accountId, providerId, c3);

    const { status, items } = await history(accountId, device);
    expect(status).toBe(200);
    expect(items.map((i) => i.executions)).toEqual([[], [], []]);
    const byId = new Map(items.map((i) => [i.ipChangedEventId, i.deliveries]));
    expect(byId.get(c1)).toEqual([expect.objectContaining({ actionId, providerName: "Nord", group: "home", kind: "delivered", stage: "applied", at: "applied-1", error: null })]);
    expect(byId.get(c2)).toEqual([expect.objectContaining({ kind: "delivered", stage: "failed", at: "failed-2", error: "template broken" })]);
    expect(byId.get(c3)).toEqual([expect.objectContaining({ kind: "delivered", stage: "published", error: null })]);
  });

  it("gives every Traefik action its own row (US1-4)", async () => {
    const accountId = `hist-multi-${Date.now()}`;
    const a = await world.provider(accountId, "Nord");
    const b = await world.provider(accountId, "Süd");
    const device = await world.device(accountId, "home");
    const actionA = await world.deliveryAction(accountId, device, a.providerId, "g1");
    const actionB = await world.deliveryAction(accountId, device, b.providerId, "g2");
    const change = await ipChanged(accountId, device, "203.0.113.5");
    await publish(accountId, a.providerId, change);
    const vb = await publish(accountId, b.providerId, change);
    await store.append(accountId, b.providerId, E.SnapshotApplied, { version: vb, correlationId: change, agentVersion: "1", stale: false, files: [], templates: [], appliedAt: "t" });

    const { items } = await history(accountId, device);
    const rows = items[0]!.deliveries;
    expect(rows.map((r) => [r.actionId, r.providerName, r.group, r.stage]).sort()).toEqual(
      [[actionA, "Nord", "g1", "published"], [actionB, "Süd", "g2", "applied"]].sort(),
    );
  });

  it("returns empty deliveries for a device without Traefik actions and hides it from other accounts", async () => {
    const accountId = `hist-none-${Date.now()}`;
    const device = await world.device(accountId, "plain");
    await ipChanged(accountId, device, "203.0.113.9");

    const own = await history(accountId, device);
    expect(own.items.map((i) => i.deliveries)).toEqual([[]]);
    expect((await history(`other-${accountId}`, device)).status).toBe(404);
  });

  it("shows no row for a change the provider published nothing for, and no error (US2-2)", async () => {
    const accountId = `hist-quiet-${Date.now()}`;
    const { providerId } = await world.provider(accountId, "Nord");
    const device = await world.device(accountId, "home");
    await world.deliveryAction(accountId, device, providerId, "g");
    const quiet = await ipChanged(accountId, device, "203.0.113.1");
    const loud = await ipChanged(accountId, device, "203.0.113.2");
    await publish(accountId, providerId, loud);

    const { items } = await history(accountId, device);
    expect(items.find((i) => i.ipChangedEventId === quiet)!.deliveries).toEqual([]);
    expect(items.find((i) => i.ipChangedEventId === loud)!.deliveries).toHaveLength(1);
  });

  it("keeps the row of a detached action (edge case)", async () => {
    const accountId = `hist-detached-${Date.now()}`;
    const { providerId } = await world.provider(accountId, "Nord");
    const device = await world.device(accountId, "home");
    const actionId = await world.deliveryAction(accountId, device, providerId, "g");
    const change = await ipChanged(accountId, device, "203.0.113.1");
    await publish(accountId, providerId, change);
    await eventStore.append({
      id: ulid(), aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId, accountId, expectedSequenceNumber: 2,
      eventName: ActionEventName.Detached, type: "t", source: "s", time: new Date().toISOString(), data: { detachedAt: new Date().toISOString() },
    });

    const { items } = await history(accountId, device);
    expect(items[0]!.deliveries).toEqual([expect.objectContaining({ actionId, stage: "published", providerName: "Nord" })]);
  });

  it("keeps the row of a deleted agent, without its name (US3)", async () => {
    const accountId = `hist-gone-${Date.now()}`;
    const { providerId } = await world.provider(accountId, "Nord");
    const device = await world.device(accountId, "home");
    await world.deliveryAction(accountId, device, providerId, "g");
    const change = await ipChanged(accountId, device, "203.0.113.1");
    await publish(accountId, providerId, change);
    await store.append(accountId, providerId, E.Deleted, { deletedAt: new Date().toISOString() });

    const { items } = await history(accountId, device);
    expect(items[0]!.deliveries).toEqual([expect.objectContaining({ providerName: null, stage: "published" })]);
  });

  it("never reads another account's provider, even if an action points at it (FR-013)", async () => {
    const accountId = `hist-iso-${Date.now()}`;
    const foreign = `${accountId}-foreign`;
    const { providerId } = await world.provider(foreign, "Fremd");
    const device = await world.device(accountId, "home");
    await world.deliveryAction(accountId, device, providerId, "g");
    const change = await ipChanged(accountId, device, "203.0.113.1");
    await publish(foreign, providerId, change);

    const { items } = await history(accountId, device);
    expect(items[0]!.deliveries).toEqual([]);
  });

  it("marks the earlier change of one coalescing window as combined (US2-1, end to end)", async () => {
    const accountId = `hist-combined-${Date.now()}`;
    const { providerId } = await world.provider(accountId, "Nord");
    const d1 = await world.device(accountId, "alpha");
    const d2 = await world.device(accountId, "beta");
    await world.deliveryAction(accountId, d1, providerId, "g");
    await world.deliveryAction(accountId, d2, providerId, "g");

    await world.reportIp(debounceQueue, accountId, d1, "203.0.113.21");
    await world.reportIp(debounceQueue, accountId, d2, "203.0.113.22");
    await waitFor(async () => {
      const events = await eventStore.readStream({ accountId, aggregateType: "traefik_provider", aggregateId: providerId });
      return events.some((e) => e.eventName === E.SnapshotPublished);
    });

    const kinds = [...(await history(accountId, d1)).items, ...(await history(accountId, d2)).items].flatMap((i) => i.deliveries.map((d) => d.kind)).sort();
    expect(kinds).toEqual(["combined", "delivered"]);
  }, 20000);
});
