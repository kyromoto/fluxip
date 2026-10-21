import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../../../helpers/in-memory-event-store.js";
import { testConfig } from "../../../helpers/test-config.js";
import { SnapshotPublisher } from "../../../../src/adapters/queue-bullmq/snapshot-publisher.js";
import { ACTION_AGGREGATE_TYPE, ActionEventName, TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE } from "../../../../src/domain/action/events.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName } from "../../../../src/domain/ip-client/events.js";
import { TraefikProviderEventName as E } from "../../../../src/domain/traefik-provider/events.js";
import { ProviderStore } from "../../../../src/domain/traefik-provider/provider-store.js";

const ACCOUNT = "acc";
const PROVIDER = "prov1";

describe("SnapshotPublisher.publishNow", () => {
  let eventStore: InMemoryEventStore;
  let store: ProviderStore;

  function publisher(overrides = {}) {
    return new SnapshotPublisher({ config: testConfig(overrides), eventStore, store });
  }

  async function raw(aggregateType: string, aggregateId: string, seq: number, eventName: string, data: unknown) {
    await eventStore.append({ id: `${aggregateId}-${seq}`, aggregateType, aggregateId, accountId: ACCOUNT, expectedSequenceNumber: seq, eventName, type: "t", source: "s", time: "t", data });
  }

  async function addDevice(id: string, ip: string) {
    await raw(IP_CLIENT_AGGREGATE_TYPE, id, 1, IpClientEventName.Registered, { ipClientId: id, accountId: ACCOUNT, label: id, credentialHash: "h", registeredAt: "t" });
    await raw(IP_CLIENT_AGGREGATE_TYPE, id, 2, IpClientEventName.IpChanged, { newIPv4: ip, settledAt: "t" });
    await raw(ACTION_AGGREGATE_TYPE, `act-${id}`, 1, ActionEventName.Attached, {
      actionId: `act-${id}`, accountId: ACCOUNT, ipClientId: id, type: TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE,
      addressFamilies: ["ipv4"], config: { traefikProviderId: PROVIDER, group: "g" }, attachedAt: "t",
    });
  }

  beforeEach(async () => {
    eventStore = new InMemoryEventStore();
    store = new ProviderStore(eventStore, testConfig());
    await store.append(ACCOUNT, PROVIDER, E.Created, { providerId: PROVIDER, accountId: ACCOUNT, name: "Nord", connectionMode: "agent_initiated", createdAt: "t" });
  });

  it("publishes the first (empty) snapshot with the event's sequence number as version", async () => {
    const snapshot = await publisher().publishNow(ACCOUNT, PROVIDER, "corr-1");
    expect(snapshot).toMatchObject({ version: 2, correlationId: "corr-1", providerName: "Nord", groups: [] });
  });

  it("does not publish again when nothing changed, and returns the same version", async () => {
    const p = publisher();
    const first = await p.publishNow(ACCOUNT, PROVIDER, "corr-1");
    const second = await p.publishNow(ACCOUNT, PROVIDER, "corr-2");
    expect(second?.version).toBe(first?.version);
    expect(second?.correlationId).toBe("corr-1");
    const events = await eventStore.readStream({ accountId: ACCOUNT, aggregateType: "traefik_provider", aggregateId: PROVIDER });
    expect(events.filter((e) => e.eventName === E.SnapshotPublished)).toHaveLength(1);
  });

  it("publishes a new, higher version when the content changes", async () => {
    const p = publisher();
    const first = await p.publishNow(ACCOUNT, PROVIDER);
    await addDevice("d1", "203.0.113.1");
    const second = await p.publishNow(ACCOUNT, PROVIDER, "corr-2");
    expect(second!.version).toBeGreaterThan(first!.version);
    expect(second!.groups[0]?.entries[0]?.ips).toEqual(["203.0.113.1"]);
    expect(second!.correlationId).toBe("corr-2");
  });

  it("serializes concurrent calls into a single publish", async () => {
    const p = publisher();
    await addDevice("d1", "203.0.113.1");
    const [a, b] = await Promise.all([p.publishNow(ACCOUNT, PROVIDER), p.publishNow(ACCOUNT, PROVIDER)]);
    expect(a?.version).toBe(b?.version);
    const events = await eventStore.readStream({ accountId: ACCOUNT, aggregateType: "traefik_provider", aggregateId: PROVIDER });
    expect(events.filter((e) => e.eventName === E.SnapshotPublished)).toHaveLength(1);
  });

  it("records a failure and returns null when the snapshot exceeds the size limit (FR-024)", async () => {
    await addDevice("d1", "203.0.113.1");
    const result = await publisher({ agentSnapshotMaxBytes: 10 }).publishNow(ACCOUNT, PROVIDER, "corr-x");
    expect(result).toBeNull();
    const { state } = await store.load(ACCOUNT, PROVIDER);
    expect(state.lastPublishError).toMatchObject({ reason: "too_large", correlationId: "corr-x" });
    expect(state.lastPublished).toBeNull();
  });

  it("returns null for unknown or deleted providers", async () => {
    expect(await publisher().publishNow(ACCOUNT, "nope")).toBeNull();
    await store.append(ACCOUNT, PROVIDER, E.Deleted, { deletedAt: "t" });
    expect(await publisher().publishNow(ACCOUNT, PROVIDER)).toBeNull();
  });
});
