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
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import { TestAgent } from "../helpers/agent-client.js";
import { TraefikWorld, waitFor } from "../helpers/traefik-world.js";

// SC-001: with the production defaults for collapsing (1 s), only the debounce window is shortened for test speed —
// the clock for the target starts at the confirmed ip_changed event, i.e. after the debounce window (clarification Q1).
const config = loadConfig({ ...process.env, BACKEND_IP_CLIENT_DEBOUNCE_MS: "100" });
const RUNS = 20;
const TARGET_MS = 10_000;

describe("SC-001: confirmed IP change -> snapshot at the connected agent", () => {
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
  let agent: TestAgent;

  beforeAll(async () => {
    await runMigrations(pool);
    port = await server.start(0, "127.0.0.1");
    debounceWorker = createDebounceWorker({ config, eventStore, redis, actionExecutionQueue, snapshots: coordinator });
  });
  afterAll(async () => {
    agent?.close();
    coordinator.stop();
    await debounceWorker.close();
    await debounceQueue.close();
    await actionExecutionQueue.close();
    await server.stop();
    await pool.end();
  });

  it(`delivers the new IP within ${TARGET_MS / 1000} s in at least 95 % of ${RUNS} runs`, async () => {
    const accountId = `acc-${Date.now()}-latency`;
    const p = await world.provider(accountId, "Latency");
    const device = await world.device(accountId, "dev");
    await world.deliveryAction(accountId, device, p.providerId, "g");
    agent = new TestAgent(port, { providerId: p.providerId, token: p.token });
    agent.hello();
    await agent.waitForMessage("snapshot");

    const latencies: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ip = `203.0.113.${100 + i}`;
      await world.reportIp(debounceQueue, accountId, device, ip);
      await waitFor(async () => (await world.ipChangedEvents(accountId, device)).length === i + 1, 10_000, 10);
      const confirmedAt = Date.parse((await world.ipChangedEvents(accountId, device))[i]!.time);
      await waitFor(() =>
        agent.messages("snapshot").some((m) => JSON.stringify(m.snapshot).includes(`"${ip}"`)),
        TARGET_MS * 2,
        10,
      );
      latencies.push(Date.now() - confirmedAt);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(RUNS * 0.95) - 1]!;
    console.log(`SC-001 latencies (ms): min=${latencies[0]} median=${latencies[RUNS >> 1]} p95=${p95} max=${latencies[RUNS - 1]}`);
    expect(latencies.filter((l) => l <= TARGET_MS).length / RUNS).toBeGreaterThanOrEqual(0.95);
  }, 120_000);
});
