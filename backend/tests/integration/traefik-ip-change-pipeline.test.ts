import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrpcAgentServer } from "../../src/adapters/agent-grpc/grpc-agent-server.js";
import { SessionRegistry } from "../../src/adapters/agent-grpc/session-registry.js";
import { SnapshotCoordinator } from "../../src/adapters/agent-grpc/snapshot-coordinator.js";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createDebounceWorker } from "../../src/adapters/queue-bullmq/debounce-worker.js";
import { createActionExecutionQueue, createDebounceQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { SnapshotPublisher } from "../../src/adapters/queue-bullmq/snapshot-publisher.js";
import { loadConfig } from "../../src/config/env.js";
import { IpClientEventName } from "../../src/domain/ip-client/events.js";
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import { TestAgent, type Wire } from "../helpers/agent-client.js";
import { TraefikWorld, waitFor } from "../helpers/traefik-world.js";

const config = loadConfig({
  ...process.env,
  BACKEND_IP_CLIENT_DEBOUNCE_MS: "150",
  BACKEND_AGENT_SNAPSHOT_COALESCE_MS: "150",
  BACKEND_AGENT_RESYNC_MS: "700",
});

interface SnapshotWire {
  version: number;
  correlationId: string;
  groups: { key: string; entries: { deviceName: string; ips: string[] }[] }[];
}
const snapshotsOf = (agent: TestAgent): SnapshotWire[] => agent.messages("snapshot").map((m: Wire) => m.snapshot as SnapshotWire);

describe("Traefik delivery: IP change -> snapshot at the agent", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const store = new ProviderStore(eventStore, config);
  const registry = new SessionRegistry();
  const publisher = new SnapshotPublisher({ config, eventStore, store });
  const coordinator = new SnapshotCoordinator({ config, publisher, registry });
  const server = new GrpcAgentServer({ config, store, publisher, registry });
  const world = new TraefikWorld(config, eventStore, store);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  let debounceWorker: ReturnType<typeof createDebounceWorker>;
  let port = 0;
  const agents: TestAgent[] = [];

  beforeAll(async () => {
    await runMigrations(pool);
    port = await server.start(0, "127.0.0.1");
    debounceWorker = createDebounceWorker({ config, eventStore, redis, actionExecutionQueue, snapshots: coordinator });
  });
  afterAll(async () => {
    agents.forEach((a) => a.close());
    coordinator.stop();
    await debounceWorker.close();
    await debounceQueue.close();
    await actionExecutionQueue.close();
    await server.stop();
    await pool.end();
  });

  async function connect(providerId: string, token: string): Promise<TestAgent> {
    const agent = new TestAgent(port, { providerId, token });
    agents.push(agent);
    agent.hello();
    await agent.waitForMessage("snapshot");
    return agent;
  }

  it("delivers a new IP to the affected agent only, tagged with the causing event, and stays quiet otherwise", async () => {
    const accountId = `acc-${Date.now()}`;
    const a = await world.provider(accountId, "A");
    const b = await world.provider(accountId, "B");
    const home = await world.device(accountId, "home");
    const other = await world.device(accountId, "other");
    await world.deliveryAction(accountId, home, a.providerId, "admin-allowlist");
    await world.deliveryAction(accountId, other, b.providerId, "admin-allowlist");

    const agentA = await connect(a.providerId, a.token);
    const agentB = await connect(b.providerId, b.token);
    expect(snapshotsOf(agentA)[0]?.groups).toEqual([]);

    // US3-1: the new IP shows up, and the snapshot carries the causing ip_changed event as correlation id (FR-061).
    await world.reportIp(debounceQueue, accountId, home, "203.0.113.10");
    await waitFor(() => snapshotsOf(agentA).some((s) => s.groups[0]?.entries[0]?.ips.includes("203.0.113.10")));
    const delivered = snapshotsOf(agentA).find((s) => s.groups.length > 0)!;
    expect(delivered.groups).toEqual([{ key: "admin-allowlist", entries: [{ deviceName: "home", ips: ["203.0.113.10"] }] }]);
    const changed = await world.ipChangedEvents(accountId, home);
    expect(delivered.correlationId).toBe(changed[0]?.id);
    expect(delivered.version).toBeGreaterThan(snapshotsOf(agentA)[0]!.version);

    // US3-2: provider B's agent got no new snapshot for that change (only its initial one, plus periodic resends of the same version).
    const initialB = snapshotsOf(agentB)[0]!;
    expect(snapshotsOf(agentB).every((s) => s.version === initialB.version)).toBe(true);

    // US3-3: reporting the same, already settled IP changes nothing — no new version.
    const versionBefore = delivered.version;
    await world.reportIp(debounceQueue, accountId, home, "203.0.113.10");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(Math.max(...snapshotsOf(agentA).map((s) => s.version))).toBe(versionBefore);

    // US3-1 (second change): the old address is gone.
    await world.reportIp(debounceQueue, accountId, home, "203.0.113.11");
    await waitFor(() => snapshotsOf(agentA).some((s) => s.groups[0]?.entries[0]?.ips.includes("203.0.113.11")));
    const latest = snapshotsOf(agentA).reduce((a, b) => (b.version > a.version ? b : a));
    expect(latest.groups[0]?.entries[0]?.ips).toEqual(["203.0.113.11"]);
    expect(JSON.stringify(latest)).not.toContain("203.0.113.10");
    expect((await world.ipChangedEvents(accountId, home)).length).toBe(2);
    expect((await world.ipChangedEvents(accountId, home))[1]?.eventName).toBe(IpClientEventName.IpChanged);
  }, 20000);

  it("puts several devices of one group into one snapshot (US2-3)", async () => {
    const accountId = `acc-${Date.now()}-multi`;
    const p = await world.provider(accountId, "Multi");
    const d1 = await world.device(accountId, "alpha");
    const d2 = await world.device(accountId, "beta");
    await world.deliveryAction(accountId, d1, p.providerId, "g");
    await world.deliveryAction(accountId, d2, p.providerId, "g");
    const agent = await connect(p.providerId, p.token);

    await world.reportIp(debounceQueue, accountId, d1, "203.0.113.21");
    await world.reportIp(debounceQueue, accountId, d2, "203.0.113.22");
    await waitFor(() => snapshotsOf(agent).some((s) => (s.groups[0]?.entries.length ?? 0) === 2));
    const full = snapshotsOf(agent).find((s) => (s.groups[0]?.entries.length ?? 0) === 2)!;
    expect(full.groups[0]?.entries.map((e) => e.deviceName).sort()).toEqual(["alpha", "beta"]);
  }, 20000);

  it("resends the current state periodically without creating a new version (FR-021)", async () => {
    const accountId = `acc-${Date.now()}-resync`;
    const p = await world.provider(accountId, "Resync");
    const agent = await connect(p.providerId, p.token);
    coordinator.startResync(() => registry.connected());
    await waitFor(() => agent.messages("snapshot").length >= 3, 6000);
    const versions = new Set(snapshotsOf(agent).map((s) => s.version));
    expect(versions.size).toBe(1);
  }, 15000);
});
