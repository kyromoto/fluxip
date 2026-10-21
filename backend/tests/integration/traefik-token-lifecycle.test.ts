import * as grpc from "@grpc/grpc-js";
import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisAuthThrottle } from "../../src/adapters/agent-grpc/auth-throttle.js";
import { GrpcAgentServer } from "../../src/adapters/agent-grpc/grpc-agent-server.js";
import { SessionRegistry } from "../../src/adapters/agent-grpc/session-registry.js";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createTraefikProvidersRoutes } from "../../src/adapters/http/routes/traefik-providers.js";
import { getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { SnapshotPublisher } from "../../src/adapters/queue-bullmq/snapshot-publisher.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import { TestAgent } from "../helpers/agent-client.js";
import { TraefikWorld, waitFor } from "../helpers/traefik-world.js";

const config = { ...loadConfig(process.env), agentPublicUrl: "https://agents.example.com" };

describe("agent credentials and lifecycle over a live session", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);
  const store = new ProviderStore(eventStore, config);
  const registry = new SessionRegistry();
  const publisher = new SnapshotPublisher({ config, eventStore, store });
  const throttle = new RedisAuthThrottle(redis, 3, 60);
  const server = new GrpcAgentServer({ config, store, publisher, registry, throttle });
  const world = new TraefikWorld(config, eventStore, store);
  let port = 0;
  const agents: TestAgent[] = [];

  const api = new Hono();
  api.use("*", async (c, next) => {
    const accountId = c.req.header("x-test-account") ?? "";
    c.set("auth", { accountId, roles: [] });
    await accountService.ensureProvisioned(accountId);
    await next();
  });
  api.route("/agents", createTraefikProvidersRoutes({ config, eventStore, store, registry }));

  beforeAll(async () => {
    await runMigrations(pool);
    port = await server.start(0, "127.0.0.1");
  });
  afterAll(async () => {
    agents.forEach((a) => a.close());
    await server.stop();
    await pool.end();
  });

  const request = (accountId: string, method: string, path: string, body?: unknown) =>
    api.request(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-test-account": accountId },
    });

  async function createViaApi(accountId: string) {
    const created = (await (await request(accountId, "POST", "/agents", { name: "Live" })).json()) as {
      providerId: string;
      token: { tokenId: string; value: string };
    };
    return { providerId: created.providerId, tokenId: created.token.tokenId, token: created.token.value };
  }

  async function connect(providerId: string, token: string, extra?: Record<string, string>): Promise<TestAgent> {
    const agent = new TestAgent(port, { providerId, token, extra });
    agents.push(agent);
    agent.hello();
    return agent;
  }

  it("rotates without downtime: the old token keeps working until it is revoked, then the live session ends (US7-1/2)", async () => {
    const accountId = `acc-${Date.now()}-rot`;
    const p = await createViaApi(accountId);
    const second = (await (await request(accountId, "POST", `/agents/${p.providerId}/tokens`, {})).json()) as { value: string };

    const oldAgent = await connect(p.providerId, p.token);
    await oldAgent.waitForMessage("snapshot");
    const newAgent = await connect(p.providerId, second.value);
    await newAgent.waitForMessage("snapshot");

    // Both tokens are valid at the same time; the newer connection superseded the older one (one session per provider).
    expect((await oldAgent.waitForError()).code).toBe(grpc.status.ABORTED);

    const started = Date.now();
    expect((await request(accountId, "DELETE", `/agents/${p.providerId}/tokens/${p.tokenId}`)).status).toBe(204);
    // The session of the second token is unaffected by revoking the first one.
    expect(registry.isConnected(p.providerId)).toBe(true);

    const rejected = await connect(p.providerId, p.token);
    expect((await rejected.waitForError()).code).toBe(grpc.status.UNAUTHENTICATED);

    // Revoking the token the live session uses ends it promptly.
    const secondTokenId = (await store.load(accountId, p.providerId)).state.tokens.find((t) => !t.revokedAt)!.tokenId;
    expect((await request(accountId, "DELETE", `/agents/${p.providerId}/tokens/${secondTokenId}`)).status).toBe(204);
    expect((await newAgent.waitForError(2000)).code).toBe(grpc.status.UNAUTHENTICATED);
    expect(Date.now() - started).toBeLessThan(3000);
    await waitFor(() => !registry.isConnected(p.providerId), 2000);

    // The disconnect event is appended just after the session leaves the registry.
    await waitFor(async () => (await store.load(accountId, p.providerId)).state.lastPresence === "disconnected", 3000);
  });

  it("ends a live session when the provider is deleted (US7-4)", async () => {
    const accountId = `acc-${Date.now()}-del`;
    const p = await createViaApi(accountId);
    const agent = await connect(p.providerId, p.token);
    await agent.waitForMessage("snapshot");

    expect((await request(accountId, "DELETE", `/agents/${p.providerId}`)).status).toBe(204);
    expect((await agent.waitForError(2000)).code).toBe(grpc.status.UNAUTHENTICATED);

    const again = await connect(p.providerId, p.token);
    expect((await again.waitForError()).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("throttles repeated failures from one source without touching valid agents elsewhere (FR-035)", async () => {
    const accountId = `acc-${Date.now()}-thr`;
    const p = await createViaApi(accountId);
    const attacker = `198.51.100.${Math.floor(Math.random() * 200)}-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      const bad = await connect(p.providerId, "fxt_wrong", { "x-forwarded-for": attacker });
      expect((await bad.waitForError()).code).toBe(grpc.status.UNAUTHENTICATED);
    }
    // Blocked now — even the right token from that source is refused for a while.
    const blocked = await connect(p.providerId, p.token, { "x-forwarded-for": attacker });
    const err = await blocked.waitForError();
    expect(err.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
    expect(err.details).toContain("too many failed attempts");

    const legit = await connect(p.providerId, p.token, { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}` });
    await legit.waitForMessage("snapshot");
  });

  it("serves the full current state to an agent that reconnects after a server restart (US5-5)", async () => {
    const accountId = `acc-${Date.now()}-restart`;
    const p = await world.provider(accountId, "Restart");
    const device = await world.device(accountId, "nas");
    await world.deliveryAction(accountId, device, p.providerId, "g");
    // The IP is known to the event store, as it would be after the earlier operation of the system.
    const events = await eventStore.readStream({ accountId, aggregateType: "ip_client", aggregateId: device });
    await eventStore.append({
      id: `${device}-ip`, aggregateType: "ip_client", aggregateId: device, accountId, expectedSequenceNumber: events.length + 1,
      eventName: "ip_changed", type: "t", source: "s", time: new Date().toISOString(), data: { newIPv4: "203.0.113.88", settledAt: "t" },
    });

    const restartedRegistry = new SessionRegistry();
    const restarted = new GrpcAgentServer({ config, store, publisher, registry: restartedRegistry });
    const restartedPort = await restarted.start(0, "127.0.0.1");
    const agent = new TestAgent(restartedPort, { providerId: p.providerId, token: p.token });
    agents.push(agent);
    agent.hello();
    const snapshot = (await agent.waitForMessage("snapshot")).snapshot as { groups: { key: string; entries: { ips: string[] }[] }[] };
    expect(snapshot.groups[0]).toMatchObject({ key: "g", entries: [{ ips: ["203.0.113.88"] }] });
    await restarted.stop();
  });
});
