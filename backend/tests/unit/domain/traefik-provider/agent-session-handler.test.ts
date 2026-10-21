import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryEventStore } from "../../../helpers/in-memory-event-store.js";
import { testConfig } from "../../../helpers/test-config.js";
import { SessionRegistry } from "../../../../src/adapters/agent-grpc/session-registry.js";
import { SnapshotPublisher } from "../../../../src/adapters/queue-bullmq/snapshot-publisher.js";
import type { AgentChannel } from "../../../../src/domain/traefik-provider/agent-channel.js";
import { AgentSessionHandler } from "../../../../src/domain/traefik-provider/agent-session-handler.js";
import type { AgentMessage, CloseReason } from "../../../../src/domain/traefik-provider/agent-protocol.js";
import { TraefikProviderEventName as E } from "../../../../src/domain/traefik-provider/events.js";
import { ProviderStore } from "../../../../src/domain/traefik-provider/provider-store.js";

const ACCOUNT = "acc";
const PROVIDER = "prov";

class FakeChannel implements AgentChannel {
  sent: AgentMessage[] = [];
  closed: CloseReason | null = null;
  constructor(
    readonly sessionId: string,
    readonly tokenId = "tok1",
  ) {}
  send(message: AgentMessage): void {
    this.sent.push(message);
  }
  close(reason: CloseReason): void {
    this.closed = reason;
  }
}

const hello = (overrides: Partial<Extract<AgentMessage, { type: "hello" }>> = {}): AgentMessage => ({
  type: "hello",
  protocolVersion: 1,
  agentVersion: "1.2.3",
  maxOfflineSeconds: 86400,
  heartbeatSeconds: 0,
  maxSnapshotBytes: 0,
  providerName: "",
  acceptedVersion: 0,
  ...overrides,
});

const report = (overrides: Partial<Extract<AgentMessage, { type: "report" }>> = {}): AgentMessage => ({
  type: "report",
  version: 2,
  correlationId: "corr",
  result: "ok",
  error: "",
  agentVersion: "1.2.3",
  stale: false,
  files: [{ name: "fluxip-a.yml", sha256: "abc" }],
  templates: [{ name: "a.yml.tmpl", sha256: "def" }],
  ...overrides,
});

describe("AgentSessionHandler", () => {
  let eventStore: InMemoryEventStore;
  let store: ProviderStore;
  let registry: SessionRegistry;
  let publisher: SnapshotPublisher;
  const config = testConfig({ agentHeartbeatSeconds: 30 });

  function handlerFor(channel: AgentChannel, now?: () => number): AgentSessionHandler {
    return new AgentSessionHandler({ providerId: PROVIDER, accountId: ACCOUNT, channel, store, publisher, registry, config, now });
  }

  async function events(): Promise<string[]> {
    return (await eventStore.readStream({ accountId: ACCOUNT, aggregateType: "traefik_provider", aggregateId: PROVIDER })).map((e) => e.eventName);
  }

  beforeEach(async () => {
    eventStore = new InMemoryEventStore();
    store = new ProviderStore(eventStore, config);
    registry = new SessionRegistry();
    publisher = new SnapshotPublisher({ config, eventStore, store });
    await store.append(ACCOUNT, PROVIDER, E.Created, { providerId: PROVIDER, accountId: ACCOUNT, name: "Nord", connectionMode: "agent_initiated", createdAt: "t" });
  });

  afterEach(() => vi.useRealTimers());

  it("answers hello with its own hello and an immediate (empty) snapshot (US1-2)", async () => {
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel);
    await handler.handle(hello());

    expect(channel.sent.map((m) => m.type)).toEqual(["hello", "snapshot"]);
    expect(channel.sent[0]).toMatchObject({ type: "hello", acceptedVersion: 1, heartbeatSeconds: 30, providerName: "Nord" });
    expect(channel.sent[1]).toMatchObject({ type: "snapshot", providerName: "Nord", groups: [] });
    expect(registry.isConnected(PROVIDER)).toBe(true);
    expect(await events()).toEqual([E.Created, E.AgentConnected, E.SnapshotPublished]);
    await handler.onClosed();
  });

  it("rejects a protocol version below the minimum with a readable message (FR-036)", async () => {
    const channel = new FakeChannel("s1");
    await handlerFor(channel).handle(hello({ protocolVersion: 0 }));
    expect(channel.closed).toMatchObject({ code: "failed_precondition", disconnect: "error" });
    expect(channel.closed?.message).toContain("protocol_version_unsupported");
    expect(registry.isConnected(PROVIDER)).toBe(false);
  });

  it("accepts a newer agent by negotiating down to the supported version", async () => {
    const channel = new FakeChannel("s1");
    await handlerFor(channel).handle(hello({ protocolVersion: 7 }));
    expect(channel.sent[0]).toMatchObject({ type: "hello", acceptedVersion: 1 });
    expect(channel.closed).toBeNull();
  });

  it("closes the session when anything but hello comes first", async () => {
    const channel = new FakeChannel("s1");
    await handlerFor(channel).handle({ type: "heartbeat", nonce: 1 });
    expect(channel.closed).toMatchObject({ code: "failed_precondition" });
  });

  it("records an ok report as snapshot_applied with checksums (FR-054)", async () => {
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel);
    await handler.handle(hello());
    await handler.handle(report());
    const { state } = await store.load(ACCOUNT, PROVIDER);
    expect(state.lastApplied).toMatchObject({ version: 2, correlationId: "corr", files: [{ name: "fluxip-a.yml", sha256: "abc" }] });
    expect(state.agentVersion).toBe("1.2.3");
  });

  it("records an error report as snapshot_apply_failed with the reason", async () => {
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel);
    await handler.handle(hello());
    await handler.handle(report({ result: "error", error: "template broken.yml.tmpl: invalid YAML" }));
    const { state } = await store.load(ACCOUNT, PROVIDER);
    expect(state.lastApplyError?.reason).toContain("invalid YAML");
    expect(state.lastApplied).toBeNull();
  });

  it("does not record reports that were ignored as older than the applied version (FR-053)", async () => {
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel);
    await handler.handle(hello());
    const before = (await events()).length;
    await handler.handle(report({ result: "ignored_stale" }));
    expect((await events()).length).toBe(before);
  });

  it("answers a sync request with the current snapshot", async () => {
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel);
    await handler.handle(hello());
    channel.sent.length = 0;
    await handler.handle({ type: "syncRequest" });
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.type).toBe("snapshot");
  });

  it("supersedes an older session of the same provider (FR-034)", async () => {
    const first = new FakeChannel("s1");
    const second = new FakeChannel("s2");
    const h1 = handlerFor(first);
    const h2 = handlerFor(second);
    await h1.handle(hello());
    await h2.handle(hello());

    expect(first.sent.at(-1)).toEqual({ type: "bye", reason: "superseded" });
    expect(first.closed).toMatchObject({ code: "aborted", disconnect: "superseded" });
    expect(registry.get(PROVIDER)?.channel.sessionId).toBe("s2");

    await h1.onClosed(first.closed ?? undefined);
    expect(registry.get(PROVIDER)?.channel.sessionId).toBe("s2");
    const { state } = await store.load(ACCOUNT, PROVIDER);
    expect(state.lastPresence).toBe("connected");
    expect(state.replacedPreviousAt).not.toBeNull();
  });

  it("records the disconnect once with the close reason", async () => {
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel);
    await handler.handle(hello());
    await handler.onClosed({ code: "unauthenticated", message: "revoked", disconnect: "revoked" });
    await handler.onClosed();
    const names = await events();
    expect(names.filter((n) => n === E.AgentDisconnected)).toHaveLength(1);
    const { state } = await store.load(ACCOUNT, PROVIDER);
    expect(state.lastPresence).toBe("disconnected");
    expect(registry.isConnected(PROVIDER)).toBe(false);
  });

  it("does not record a disconnect for a session that never completed hello", async () => {
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel);
    await handler.onClosed();
    expect(await events()).toEqual([E.Created]);
  });

  it("sends heartbeats and drops a silent peer after three missed intervals", async () => {
    vi.useFakeTimers();
    let clock = 1_000_000;
    const channel = new FakeChannel("s1");
    const handler = handlerFor(channel, () => clock);
    await handler.handle(hello());

    clock += 30_000;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.sent.some((m) => m.type === "heartbeat")).toBe(true);
    expect(channel.closed).toBeNull();

    clock += 3 * 30_000 + 1;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.closed).toMatchObject({ code: "deadline_exceeded", disconnect: "timeout" });
    await handler.onClosed();
  });
});
