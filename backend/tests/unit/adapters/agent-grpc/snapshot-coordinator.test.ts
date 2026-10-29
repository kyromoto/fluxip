import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "../../../../src/adapters/agent-grpc/session-registry.js";
import { SnapshotCoordinator, type SnapshotPublishing } from "../../../../src/adapters/agent-grpc/snapshot-coordinator.js";
import type { PublishResult } from "../../../../src/adapters/queue-bullmq/snapshot-publisher.js";
import type { AgentChannel } from "../../../../src/domain/traefik-provider/agent-channel.js";
import type { AgentMessage } from "../../../../src/domain/traefik-provider/agent-protocol.js";

const snapshot = (version: number, correlationId = `c${version}`) => ({
  version,
  correlationId,
  generatedAt: "t",
  providerName: "Nord",
  groups: [],
});

describe("SnapshotCoordinator", () => {
  let registry: SessionRegistry;
  let sent: AgentMessage[];
  let calls: { providerId: string; causationId?: string; absorbed?: string[] }[];
  let results: (PublishResult | null)[];
  let coordinator: SnapshotCoordinator;
  let gate: Promise<void> | null;

  const publisher: SnapshotPublishing = {
    async publish(_account, providerId, causationId, absorbedCausationIds) {
      calls.push(absorbedCausationIds?.length ? { providerId, causationId, absorbed: absorbedCausationIds } : { providerId, causationId });
      if (gate) await gate;
      return results.shift() ?? { changed: false, snapshot: snapshot(1) };
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new SessionRegistry();
    sent = [];
    calls = [];
    results = [];
    gate = null;
    const channel: AgentChannel = { sessionId: "s1", tokenId: "t1", send: (m) => sent.push(m), close: () => undefined };
    registry.register({ providerId: "p1", accountId: "a1", channel, connectedAt: "now" });
    coordinator = new SnapshotCoordinator({ config: { agentSnapshotCoalesceMs: 1000, agentResyncMs: 60_000 }, publisher, registry });
  });
  afterEach(() => {
    coordinator.stop();
    vi.useRealTimers();
  });

  it("collapses several triggers within the window into one run with the latest cause (FR-022)", async () => {
    results.push({ changed: true, snapshot: snapshot(5, "cause-3") });
    await coordinator.schedule("a1", ["p1"], "cause-1");
    await vi.advanceTimersByTimeAsync(400);
    await coordinator.schedule("a1", ["p1"], "cause-2");
    await coordinator.schedule("a1", ["p1"], "cause-3");
    await vi.advanceTimersByTimeAsync(1000);

    expect(calls).toEqual([{ providerId: "p1", causationId: "cause-3", absorbed: ["cause-1", "cause-2"] }]);
    expect(sent).toEqual([expect.objectContaining({ type: "snapshot", version: 5, correlationId: "cause-3" })]);
  });

  it("ignores triggers without a cause when collecting absorbed causes (specs/009)", async () => {
    results.push({ changed: true, snapshot: snapshot(5, "cause-2") });
    await coordinator.schedule("a1", ["p1"], "cause-1");
    await coordinator.schedule("a1", ["p1"]);
    await coordinator.schedule("a1", ["p1"], "cause-2");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([{ providerId: "p1", causationId: "cause-2", absorbed: ["cause-1"] }]);
  });

  it("hands each run only the causes collected since the previous one (specs/009)", async () => {
    results.push({ changed: true, snapshot: snapshot(2) }, { changed: true, snapshot: snapshot(3) });
    await coordinator.schedule("a1", ["p1"], "a");
    await coordinator.schedule("a1", ["p1"], "b");
    await vi.advanceTimersByTimeAsync(1000);
    await coordinator.schedule("a1", ["p1"], "c");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([
      { providerId: "p1", causationId: "b", absorbed: ["a"] },
      { providerId: "p1", causationId: "c" },
    ]);
  });

  it("sends nothing when the recomputed content did not change (US3-3)", async () => {
    results.push({ changed: false, snapshot: snapshot(5) });
    await coordinator.schedule("a1", ["p1"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("only touches the providers it was asked about (US3-2)", async () => {
    results.push({ changed: true, snapshot: snapshot(2) });
    await coordinator.schedule("a1", ["other-provider"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([{ providerId: "other-provider", causationId: undefined }]);
    expect(sent).toEqual([]);
  });

  it("runs once more when a trigger arrives during a run, so the final state wins (US3-4)", async () => {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    results.push({ changed: true, snapshot: snapshot(2) }, { changed: true, snapshot: snapshot(3) });

    await coordinator.schedule("a1", ["p1"], "first");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);

    await coordinator.schedule("a1", ["p1"], "second");
    gate = null;
    release();
    await vi.advanceTimersByTimeAsync(1000);

    expect(calls.map((c) => c.causationId)).toEqual(["first", "second"]);
    expect(sent.map((m) => (m as { version: number }).version)).toEqual([2, 3]);
  });

  it("keeps going after a failed run", async () => {
    const failing: SnapshotPublishing = {
      publish: vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ changed: true, snapshot: snapshot(9) }),
    };
    const c = new SnapshotCoordinator({ config: { agentSnapshotCoalesceMs: 100, agentResyncMs: 60_000 }, publisher: failing, registry });
    await c.schedule("a1", ["p1"]);
    await vi.advanceTimersByTimeAsync(100);
    await c.schedule("a1", ["p1"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(1);
    c.stop();
  });

  it("resends the current state to connected agents periodically, changed or not (FR-021)", async () => {
    results.push({ changed: false, snapshot: snapshot(4) });
    coordinator.startResync(() => registry.connected());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([expect.objectContaining({ type: "snapshot", version: 4 })]);
  });

  it("stops cleanly", async () => {
    await coordinator.schedule("a1", ["p1"]);
    coordinator.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([]);
    await coordinator.schedule("a1", ["p1"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([]);
  });
});
