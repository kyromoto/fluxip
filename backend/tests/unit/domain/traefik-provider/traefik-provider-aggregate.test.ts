import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../../../../src/ports/event-store.js";
import { TraefikProviderEventName as E } from "../../../../src/domain/traefik-provider/events.js";
import {
  activeTokens,
  initialTraefikProviderState,
  traefikProviderReducer,
} from "../../../../src/domain/traefik-provider/traefik-provider-aggregate.js";

function replay(events: [string, unknown][]) {
  return events.reduce(
    (state, [eventName, data], index) =>
      traefikProviderReducer(state, {
        id: String(index),
        aggregateType: "traefik_provider",
        aggregateId: "p1",
        sequenceNumber: index + 1,
        accountId: "a1",
        eventName,
        type: "t",
        source: "s",
        time: "t",
        data,
      } satisfies StoredEvent),
    initialTraefikProviderState,
  );
}

const created: [string, unknown] = [
  E.Created,
  { providerId: "p1", accountId: "a1", name: "Nord", connectionMode: "agent_initiated", createdAt: "2026-01-01T00:00:00Z" },
];

describe("traefikProviderReducer", () => {
  it("folds creation, rename and deletion", () => {
    const state = replay([created, [E.Renamed, { name: "Süd", renamedAt: "x" }], [E.Deleted, { deletedAt: "y" }]]);
    expect(state).toMatchObject({ providerId: "p1", accountId: "a1", name: "Süd", status: "deleted", lastPresence: "never" });
  });

  it("tracks tokens and revocation", () => {
    const state = replay([
      created,
      [E.TokenIssued, { tokenId: "t1", tokenHash: "h1", last4: "aaaa", issuedAt: "1" }],
      [E.TokenIssued, { tokenId: "t2", tokenHash: "h2", last4: "bbbb", issuedAt: "2" }],
      [E.TokenRevoked, { tokenId: "t1", revokedAt: "3" }],
    ]);
    expect(activeTokens(state).map((t) => t.tokenId)).toEqual(["t2"]);
    expect(state.tokens.find((t) => t.tokenId === "t1")?.revokedAt).toBe("3");
  });

  it("uses the event's sequence number as the published version", () => {
    const state = replay([
      created,
      [E.TokenIssued, { tokenId: "t1", tokenHash: "h1", last4: "aaaa", issuedAt: "1" }],
      [E.SnapshotPublished, { contentHash: "c1", groupCount: 1, entryCount: 2, correlationId: "corr", publishedAt: "p" }],
    ]);
    expect(state.lastPublished).toEqual({ version: 3, contentHash: "c1", correlationId: "corr", publishedAt: "p" });
  });

  it("clears the publish error after a successful publish", () => {
    const state = replay([
      created,
      [E.SnapshotPublishFailed, { reason: "too_large", correlationId: "c", failedAt: "f" }],
      [E.SnapshotPublished, { contentHash: "c1", groupCount: 0, entryCount: 0, correlationId: "c2", publishedAt: "p" }],
    ]);
    expect(state.lastPublishError).toBeNull();
  });

  it("follows connect/disconnect and keeps the newer connection authoritative when the old one ends as superseded", () => {
    const connected = (replaced: boolean, at: string): [string, unknown] => [
      E.AgentConnected,
      { sessionId: "s", tokenId: "t1", agentVersion: "1.0.0", protocolVersion: 1, maxOfflineSeconds: 60, replacedPrevious: replaced, connectedAt: at },
    ];
    const afterClose = replay([created, connected(false, "1"), [E.AgentDisconnected, { sessionId: "s", reason: "closed", disconnectedAt: "2" }]]);
    expect(afterClose.lastPresence).toBe("disconnected");

    const superseded = replay([
      created,
      connected(false, "1"),
      connected(true, "2"),
      [E.AgentDisconnected, { sessionId: "s", reason: "superseded", disconnectedAt: "3" }],
    ]);
    expect(superseded.lastPresence).toBe("connected");
    expect(superseded.replacedPreviousAt).toBe("2");
    expect(superseded.maxOfflineSeconds).toBe(60);
  });

  it("records applied reports and failures, clearing the error on success", () => {
    const state = replay([
      created,
      [E.SnapshotApplyFailed, { version: 5, correlationId: "c", reason: "bad yaml", appliedAt: "a" }],
    ]);
    expect(state.lastApplyError).toMatchObject({ version: 5, reason: "bad yaml" });
    const recovered = replay([
      created,
      [E.SnapshotApplyFailed, { version: 5, correlationId: "c", reason: "bad yaml", appliedAt: "a" }],
      [E.SnapshotApplied, { version: 6, correlationId: "c2", agentVersion: "1.0.0", stale: false, files: [], templates: [], appliedAt: "b" }],
    ]);
    expect(recovered.lastApplyError).toBeNull();
    expect(recovered.lastApplied?.version).toBe(6);
  });
});
