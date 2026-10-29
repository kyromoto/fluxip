import { describe, expect, it } from "vitest";
import { deriveDeliveries, type DeliveryProvider } from "../../../../src/domain/traefik-provider/delivery-history.js";
import { TraefikProviderEventName as E } from "../../../../src/domain/traefik-provider/events.js";
import type { StoredEvent } from "../../../../src/ports/event-store.js";

let seq = 0;
const ev = (eventName: string, data: unknown): StoredEvent => ({
  id: `e${++seq}`,
  aggregateType: "traefik_provider",
  aggregateId: "p1",
  sequenceNumber: seq,
  accountId: "a",
  eventName,
  type: "t",
  source: "s",
  time: "t",
  data,
});
const published = (correlationId: string, extra: Record<string, unknown> = {}) =>
  ev(E.SnapshotPublished, { contentHash: "h", groupCount: 1, entryCount: 1, correlationId, publishedAt: `pub-${correlationId}`, ...extra });
const applied = (version: number, appliedAt = `applied-${version}`) =>
  ev(E.SnapshotApplied, { version, correlationId: "x", agentVersion: "1", stale: false, files: [], templates: [], appliedAt });
const applyFailed = (version: number, reason = "bad yaml") =>
  ev(E.SnapshotApplyFailed, { version, correlationId: "x", reason, appliedAt: `failed-${version}` });

const action = { actionId: "act1", traefikProviderId: "p1", group: "home" };
const provider = (events: StoredEvent[], name: string | null = "Nord"): Map<string, DeliveryProvider> => new Map([["p1", { name, events }]]);
const derive = (events: StoredEvent[], changes = ["c1"], name: string | null = "Nord") =>
  deriveDeliveries({ ipChangedEventIds: changes, actions: [action], providers: provider(events, name) });

describe("deriveDeliveries — delivered rows (US1)", () => {
  it("is published (pending) until the agent reports", () => {
    const rows = derive([published("c1")]).get("c1")!;
    expect(rows).toEqual([
      { actionId: "act1", traefikProviderId: "p1", providerName: "Nord", group: "home", kind: "delivered", stage: "published", at: "pub-c1", error: null, version: expect.any(Number) },
    ]);
  });

  it("is applied when the agent applied that version, with the time of the report", () => {
    const pub = published("c1");
    const rows = derive([pub, applied(pub.sequenceNumber)]).get("c1")!;
    expect(rows[0]).toMatchObject({ stage: "applied", at: `applied-${pub.sequenceNumber}`, error: null });
  });

  it("counts a newer applied version as applied, using the first report at or above the version", () => {
    const pub = published("c1");
    const rows = derive([pub, published("later"), applied(pub.sequenceNumber + 1, "t-later"), applied(pub.sequenceNumber + 1, "t-even-later")]).get("c1")!;
    expect(rows[0]).toMatchObject({ stage: "applied", at: "t-later" });
  });

  it("is failed with the reported reason when the agent failed that exact version", () => {
    const pub = published("c1");
    const rows = derive([pub, applyFailed(pub.sequenceNumber, "template broken")]).get("c1")!;
    expect(rows[0]).toMatchObject({ stage: "failed", error: "template broken", at: `failed-${pub.sequenceNumber}` });
  });

  it("does not let an older failure of another version leak onto this one", () => {
    const first = published("c1");
    const failure = applyFailed(first.sequenceNumber);
    const second = published("c2");
    const rows = derive([first, failure, second], ["c1", "c2"]);
    expect(rows.get("c1")![0]).toMatchObject({ stage: "failed" });
    expect(rows.get("c2")![0]).toMatchObject({ stage: "published" });
  });

  it("is failed when publishing the snapshot failed", () => {
    const rows = derive([ev(E.SnapshotPublishFailed, { reason: "too_large", correlationId: "c1", failedAt: "t-fail" })]).get("c1")!;
    expect(rows[0]).toMatchObject({ kind: "delivered", stage: "failed", error: "too_large", at: "t-fail", version: null });
  });

  it("creates no row for changes no provider event names", () => {
    const rows = derive([published("other")], ["c1"]);
    expect(rows.get("c1")).toEqual([]);
  });

  it("gives each action its own row, with its own provider's stage", () => {
    const events1 = [published("c1")];
    const events2 = [(() => { const p = published("c1"); return p; })()];
    events2.push(applied(events2[0]!.sequenceNumber));
    const rows = deriveDeliveries({
      ipChangedEventIds: ["c1"],
      actions: [action, { actionId: "act2", traefikProviderId: "p2", group: "edge" }],
      providers: new Map([
        ["p1", { name: "Nord", events: events1 }],
        ["p2", { name: "Süd", events: events2 }],
      ]),
    }).get("c1")!;
    expect(rows.map((r) => [r.actionId, r.providerName, r.stage])).toEqual([
      ["act1", "Nord", "published"],
      ["act2", "Süd", "applied"],
    ]);
  });

  it("keeps the row with a null name when the provider is gone", () => {
    const rows = derive([published("c1")], ["c1"], null).get("c1")!;
    expect(rows[0]).toMatchObject({ providerName: null, stage: "published" });
  });
});

describe("deriveDeliveries — combined rows (US2)", () => {
  it("marks an absorbed change as combined, without a stage", () => {
    const rows = derive([published("c2", { absorbedCausationIds: ["c1"] })], ["c1", "c2"]);
    expect(rows.get("c1")![0]).toMatchObject({ kind: "combined", stage: null, at: null, error: null });
    expect(rows.get("c2")![0]).toMatchObject({ kind: "delivered", stage: "published" });
  });

  it("also marks changes absorbed by a failed publication", () => {
    const rows = derive([ev(E.SnapshotPublishFailed, { reason: "internal", correlationId: "c2", absorbedCausationIds: ["c1"], failedAt: "t" })], ["c1", "c2"]);
    expect(rows.get("c1")![0]).toMatchObject({ kind: "combined" });
    expect(rows.get("c2")![0]).toMatchObject({ kind: "delivered", stage: "failed" });
  });

  it("shows no combined row for events from before the field existed", () => {
    expect(derive([published("c2")], ["c1", "c2"]).get("c1")).toEqual([]);
  });

  it("lets delivered win over combined for the same change", () => {
    const rows = derive([published("c1"), published("c3", { absorbedCausationIds: ["c1"] })], ["c1", "c3"]);
    expect(rows.get("c1")).toHaveLength(1);
    expect(rows.get("c1")![0]!.kind).toBe("delivered");
  });
});
