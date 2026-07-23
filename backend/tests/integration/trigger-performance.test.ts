import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createTriggerRoutes } from "../../src/adapters/http/routes/trigger.js";
import { createDebounceQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { buildDomainEvent } from "../../src/domain/cloud-events.js";
import { generateCredential } from "../../src/domain/ip-client/credential.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName, type IpClientRegisteredData } from "../../src/domain/ip-client/events.js";

const config = loadConfig(process.env);

const TOTAL_REQUESTS = 300;
const CONCURRENCY = 20;
const P95_THRESHOLD_MS = 200; // plan.md Performance Goals

function percentile(sortedValues: number[], p: number): number {
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[index] ?? 0;
}

/**
 * Validates plan.md's trigger-endpoint performance goal (<200ms p95) against
 * a real bound HTTP server (not an in-process Hono `.request()` call, which
 * bypasses the actual TCP/HTTP stack) with real Postgres+Redis behind it —
 * the same dependencies (credential-hash replay, ip_report_received append,
 * debounce reschedule) every real request pays for. Load is spread across
 * `CONCURRENCY` distinct IP Clients (round-robin), not one repeatedly: a
 * single real device never sends itself concurrent duplicate reports, and
 * hammering one aggregate concurrently would just measure optimistic-
 * concurrency conflict/retry behavior, not the realistic many-devices load
 * the endpoint actually needs to scale for.
 */
describe("Trigger endpoint performance (plan.md Performance Goals)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const debounceQueue = createDebounceQueue(config);
  let server: ServerType;
  let baseUrl: string;

  const tenantId = `test-perf-${Date.now()}`;
  const ipClients: { ipClientId: string; secret: string }[] = [];

  beforeAll(async () => {
    await runMigrations(pool);

    for (let i = 0; i < CONCURRENCY; i++) {
      const ipClientId = `test-perf-ipc-${Date.now()}-${i}`;
      const generated = generateCredential();
      const registeredData: IpClientRegisteredData = {
        ipClientId,
        accountId: tenantId,
        label: `Perf test device ${i}`,
        credentialHash: generated.hash,
        registeredAt: new Date().toISOString(),
      };
      const built = buildDomainEvent(config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.Registered, registeredData);
      await eventStore.append({
        id: built.id,
        aggregateType: IP_CLIENT_AGGREGATE_TYPE,
        aggregateId: ipClientId,
        tenantId,
        expectedSequenceNumber: 1,
        eventName: IpClientEventName.Registered,
        type: built.type,
        source: built.source,
        time: built.time,
        data: built.data,
      });
      ipClients.push({ ipClientId, secret: generated.secret });
    }

    const app = new Hono();
    app.route("/", createTriggerRoutes({ config, eventStore, debounceQueue }));

    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        baseUrl = `http://localhost:${info.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await debounceQueue.close();
    await pool.end();
  });

  it(`keeps p95 latency under ${P95_THRESHOLD_MS}ms across ${TOTAL_REQUESTS} requests (concurrency ${CONCURRENCY})`, async () => {
    const durations: number[] = [];

    async function fireOne(client: { ipClientId: string; secret: string }, i: number): Promise<void> {
      const auth = Buffer.from(`${client.ipClientId}:${client.secret}`).toString("base64");
      const start = performance.now();
      const res = await fetch(`${baseUrl}/nic/update?hostname=test&myip=203.0.113.${i % 250}`, {
        headers: { authorization: `Basic ${auth}` },
      });
      durations.push(performance.now() - start);
      expect(res.status).toBe(200);
    }

    // Each of the CONCURRENCY workers owns one dedicated IP Client and sends
    // its reports sequentially — CONCURRENCY distinct devices reporting
    // concurrently relative to each other, never the same device racing itself.
    async function worker(client: { ipClientId: string; secret: string }): Promise<void> {
      const requestsPerWorker = Math.ceil(TOTAL_REQUESTS / CONCURRENCY);
      for (let i = 0; i < requestsPerWorker; i++) {
        await fireOne(client, i);
      }
    }
    await Promise.all(ipClients.map((client) => worker(client)));

    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    console.log(`Trigger endpoint latency over ${TOTAL_REQUESTS} requests: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);

    expect(durations).toHaveLength(TOTAL_REQUESTS);
    expect(p95).toBeLessThan(P95_THRESHOLD_MS);
  }, 30000);
});
