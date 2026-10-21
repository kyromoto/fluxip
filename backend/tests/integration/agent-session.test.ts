import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as grpc from "@grpc/grpc-js";
import { GrpcAgentServer, AUTH_FAILURE_MESSAGE } from "../../src/adapters/agent-grpc/grpc-agent-server.js";
import { SessionRegistry } from "../../src/adapters/agent-grpc/session-registry.js";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { SnapshotPublisher } from "../../src/adapters/queue-bullmq/snapshot-publisher.js";
import { loadConfig } from "../../src/config/env.js";
import { ACTION_AGGREGATE_TYPE, ActionEventName, TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE } from "../../src/domain/action/events.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName } from "../../src/domain/ip-client/events.js";
import { TraefikProviderEventName as E } from "../../src/domain/traefik-provider/events.js";
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import { generateAgentToken } from "../../src/domain/traefik-provider/token.js";
import { TestAgent } from "../helpers/agent-client.js";

const config = loadConfig(process.env);

describe("agent session over gRPC (variant A)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const store = new ProviderStore(eventStore, config);
  const registry = new SessionRegistry();
  const publisher = new SnapshotPublisher({ config, eventStore, store });
  const server = new GrpcAgentServer({ config, store, publisher, registry });
  let port = 0;
  const agents: TestAgent[] = [];

  beforeAll(async () => {
    await runMigrations(pool);
    port = await server.start(0, "127.0.0.1");
  });
  afterAll(async () => {
    agents.forEach((a) => a.close());
    await server.stop();
    await pool.end();
  });

  const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function newProvider(accountId: string, name: string) {
    const providerId = uid("prov");
    await store.append(accountId, providerId, E.Created, { providerId, accountId, name, connectionMode: "agent_initiated", createdAt: new Date().toISOString() });
    const token = generateAgentToken();
    const tokenId = uid("tok");
    await store.append(accountId, providerId, E.TokenIssued, { tokenId, tokenHash: token.hash, last4: token.last4, issuedAt: new Date().toISOString() });
    return { providerId, token: token.plaintext, tokenId };
  }

  function connect(opts: { providerId: string; token?: string; extra?: Record<string, string> }) {
    const agent = new TestAgent(port, opts);
    agents.push(agent);
    return agent;
  }

  async function addDeviceWithAction(accountId: string, providerId: string, label: string, ip: string, group: string) {
    const ipClientId = uid("dev");
    const actionId = uid("act");
    const base = { accountId, type: "t", source: "s", time: new Date().toISOString() };
    await eventStore.append({ ...base, id: uid("e"), aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId, expectedSequenceNumber: 1, eventName: IpClientEventName.Registered, data: { ipClientId, accountId, label, credentialHash: "h", registeredAt: "t" } });
    await eventStore.append({ ...base, id: uid("e"), aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId, expectedSequenceNumber: 2, eventName: IpClientEventName.IpChanged, data: { newIPv4: ip, settledAt: "t" } });
    await eventStore.append({
      ...base,
      id: uid("e"),
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      expectedSequenceNumber: 1,
      eventName: ActionEventName.Attached,
      data: { actionId, accountId, ipClientId, type: TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE, addressFamilies: ["ipv4", "ipv6"], config: { traefikProviderId: providerId, group }, attachedAt: "t" },
    });
  }

  it("greets a valid agent with hello and a first snapshot, even an empty one (US1-2)", async () => {
    const accountId = uid("acc");
    const { providerId, token } = await newProvider(accountId, "Nord");
    const agent = connect({ providerId, token });
    agent.hello();

    const hello = await agent.waitForMessage("hello");
    expect(hello.hello).toMatchObject({ acceptedVersion: 1, providerName: "Nord", heartbeatSeconds: config.agentHeartbeatSeconds });
    const snapshot = await agent.waitForMessage("snapshot");
    expect(snapshot.snapshot).toMatchObject({ providerName: "Nord", groups: [] });
    expect((snapshot.snapshot as { version: number }).version).toBeGreaterThan(0);
    expect(registry.isConnected(providerId)).toBe(true);
  });

  it("records an applied report and reflects it in the provider state", async () => {
    const accountId = uid("acc");
    const { providerId, token } = await newProvider(accountId, "Report");
    const agent = connect({ providerId, token });
    agent.hello();
    const snapshot = (await agent.waitForMessage("snapshot")).snapshot as { version: number; correlationId: string };
    agent.send({ report: { version: snapshot.version, correlationId: snapshot.correlationId, result: "RESULT_OK", agentVersion: "test-1.0.0", files: [{ name: "fluxip-a.yml", sha256: "abc" }] } });

    await agent.waitUntil(() => false, 300).catch(() => undefined);
    const { state } = await store.load(accountId, providerId);
    expect(state.lastApplied).toMatchObject({ version: snapshot.version, correlationId: snapshot.correlationId });
    expect(state.lastConnectedAt).not.toBeNull();
  });

  it("rejects a wrong token with the same message as an unknown provider (no probing)", async () => {
    const accountId = uid("acc");
    const { providerId } = await newProvider(accountId, "Locked");

    const wrongToken = connect({ providerId, token: "fxt_wrong" });
    wrongToken.hello();
    const e1 = await wrongToken.waitForError();
    expect(e1.code).toBe(grpc.status.UNAUTHENTICATED);
    expect(e1.details).toBe(AUTH_FAILURE_MESSAGE);

    const unknown = connect({ providerId: "does-not-exist", token: "fxt_wrong" });
    unknown.hello();
    const e2 = await unknown.waitForError();
    expect(e2.code).toBe(grpc.status.UNAUTHENTICATED);
    expect(e2.details).toBe(AUTH_FAILURE_MESSAGE);

    const missing = connect({ providerId });
    missing.hello();
    expect((await missing.waitForError()).code).toBe(grpc.status.UNAUTHENTICATED);
    expect(registry.isConnected(providerId)).toBe(false);
  });

  it("rejects a revoked token (US1-3)", async () => {
    const accountId = uid("acc");
    const { providerId, token, tokenId } = await newProvider(accountId, "Revoked");
    await store.append(accountId, providerId, E.TokenRevoked, { tokenId, revokedAt: new Date().toISOString() });
    const agent = connect({ providerId, token });
    agent.hello();
    expect((await agent.waitForError()).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("keeps two providers of one account apart (US1-4)", async () => {
    const accountId = uid("acc");
    const a = await newProvider(accountId, "A");
    const b = await newProvider(accountId, "B");
    await addDeviceWithAction(accountId, b.providerId, "only-b", "203.0.113.7", "admin");

    const agentA = connect({ providerId: a.providerId, token: a.token });
    const agentB = connect({ providerId: b.providerId, token: b.token });
    agentA.hello();
    agentB.hello();
    const snapA = (await agentA.waitForMessage("snapshot")).snapshot as { groups: unknown[] };
    const snapB = (await agentB.waitForMessage("snapshot")).snapshot as { groups: { key: string; entries: { deviceName: string; ips: string[] }[] }[] };
    expect(snapA.groups).toEqual([]);
    expect(snapB.groups).toEqual([{ key: "admin", entries: [{ deviceName: "only-b", ips: ["203.0.113.7"] }] }]);

    // A token of provider A must not open provider B.
    const cross = connect({ providerId: b.providerId, token: a.token });
    cross.hello();
    expect((await cross.waitForError()).code).toBe(grpc.status.UNAUTHENTICATED);
  });

  it("refuses to start with anything but hello and rejects an unsupported protocol version", async () => {
    const accountId = uid("acc");
    const { providerId, token } = await newProvider(accountId, "Proto");
    const early = connect({ providerId, token });
    early.send({ heartbeat: { nonce: 1 } });
    expect((await early.waitForError()).code).toBe(grpc.status.FAILED_PRECONDITION);

    const old = connect({ providerId, token });
    old.hello({ protocolVersion: 0 });
    const error = await old.waitForError();
    expect(error.code).toBe(grpc.status.FAILED_PRECONDITION);
    expect(error.details).toContain("protocol_version_unsupported");
  });

  it("ends the older session when a second agent uses the same credentials (FR-034)", async () => {
    const accountId = uid("acc");
    const { providerId, token } = await newProvider(accountId, "Twin");
    const first = connect({ providerId, token });
    first.hello();
    await first.waitForMessage("snapshot");
    const second = connect({ providerId, token });
    second.hello();
    await second.waitForMessage("snapshot");

    const error = await first.waitForError();
    expect(error.code).toBe(grpc.status.ABORTED);
    expect(first.messages("bye")[0]?.bye).toMatchObject({ reason: "superseded" });
    expect(registry.isConnected(providerId)).toBe(true);
    const { state } = await store.load(accountId, providerId);
    expect(state.replacedPreviousAt).not.toBeNull();
  });
});
