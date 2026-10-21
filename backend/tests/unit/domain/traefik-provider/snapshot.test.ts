import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../../../helpers/in-memory-event-store.js";
import { ACTION_AGGREGATE_TYPE, ActionEventName, TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE } from "../../../../src/domain/action/events.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName } from "../../../../src/domain/ip-client/events.js";
import {
  buildSnapshotContent,
  snapshotApproxBytes,
  snapshotContentHash,
} from "../../../../src/domain/traefik-provider/snapshot.js";

const ACCOUNT = "acc";

async function add(store: InMemoryEventStore, aggregateType: string, aggregateId: string, seq: number, eventName: string, data: unknown) {
  await store.append({
    id: `${aggregateId}-${seq}`,
    aggregateType,
    aggregateId,
    accountId: ACCOUNT,
    expectedSequenceNumber: seq,
    eventName,
    type: "t",
    source: "s",
    time: "t",
    data,
  });
}

async function device(store: InMemoryEventStore, id: string, label: string, ipv4?: string, ipv6?: string) {
  await add(store, IP_CLIENT_AGGREGATE_TYPE, id, 1, IpClientEventName.Registered, {
    ipClientId: id,
    accountId: ACCOUNT,
    label,
    credentialHash: "h",
    registeredAt: "t",
  });
  if (ipv4 || ipv6) {
    await add(store, IP_CLIENT_AGGREGATE_TYPE, id, 2, IpClientEventName.IpChanged, { newIPv4: ipv4, newIPv6: ipv6, settledAt: "t" });
  }
}

async function deliveryAction(store: InMemoryEventStore, actionId: string, ipClientId: string, providerId: string, group: string) {
  await add(store, ACTION_AGGREGATE_TYPE, actionId, 1, ActionEventName.Attached, {
    actionId,
    accountId: ACCOUNT,
    ipClientId,
    type: TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE,
    addressFamilies: ["ipv4", "ipv6"],
    config: { traefikProviderId: providerId, group },
    attachedAt: "t",
  });
}

describe("buildSnapshotContent", () => {
  it("is empty when no action points at the provider", async () => {
    const store = new InMemoryEventStore();
    await expect(buildSnapshotContent(store, ACCOUNT, "p1", "Nord")).resolves.toEqual({ providerName: "Nord", groups: [] });
  });

  it("collects all devices of a group, sorted, with IPv4 and IPv6", async () => {
    const store = new InMemoryEventStore();
    await device(store, "d1", "Zebra", "203.0.113.2");
    await device(store, "d2", "Alpha", "203.0.113.1", "2001:db8::1");
    await deliveryAction(store, "a1", "d1", "p1", "admin-allowlist");
    await deliveryAction(store, "a2", "d2", "p1", "admin-allowlist");

    const content = await buildSnapshotContent(store, ACCOUNT, "p1", "Nord");
    expect(content.groups).toEqual([
      {
        key: "admin-allowlist",
        entries: [
          { deviceName: "Alpha", ips: ["203.0.113.1", "2001:db8::1"] },
          { deviceName: "Zebra", ips: ["203.0.113.2"] },
        ],
      },
    ]);
  });

  it("skips devices that never reported an IP (FR-012)", async () => {
    const store = new InMemoryEventStore();
    await device(store, "d1", "Silent");
    await deliveryAction(store, "a1", "d1", "p1", "g");
    expect((await buildSnapshotContent(store, ACCOUNT, "p1", "Nord")).groups).toEqual([]);
  });

  it("skips disabled and decommissioned devices and disabled or detached actions", async () => {
    const store = new InMemoryEventStore();
    await device(store, "d1", "Off", "203.0.113.1");
    await device(store, "d2", "Gone", "203.0.113.2");
    await device(store, "d3", "PausedAction", "203.0.113.3");
    await device(store, "d4", "Detached", "203.0.113.4");
    await add(store, IP_CLIENT_AGGREGATE_TYPE, "d1", 3, IpClientEventName.Disabled, { ipClientId: "d1" });
    await add(store, IP_CLIENT_AGGREGATE_TYPE, "d2", 3, IpClientEventName.Decommissioned, { decommissionedAt: "t" });
    for (const [i, d] of ["d1", "d2", "d3", "d4"].entries()) await deliveryAction(store, `a${i}`, d, "p1", "g");
    await add(store, ACTION_AGGREGATE_TYPE, "a2", 2, ActionEventName.Disabled, { actionId: "a2" });
    await add(store, ACTION_AGGREGATE_TYPE, "a3", 2, ActionEventName.Detached, { detachedAt: "t" });
    expect((await buildSnapshotContent(store, ACCOUNT, "p1", "Nord")).groups).toEqual([]);
  });

  it("keeps providers apart and lets a device appear at several providers", async () => {
    const store = new InMemoryEventStore();
    await device(store, "d1", "Both", "203.0.113.1");
    await deliveryAction(store, "a1", "d1", "p1", "g1");
    await deliveryAction(store, "a2", "d1", "p2", "g2");
    expect((await buildSnapshotContent(store, ACCOUNT, "p1", "A")).groups.map((g) => g.key)).toEqual(["g1"]);
    expect((await buildSnapshotContent(store, ACCOUNT, "p2", "B")).groups.map((g) => g.key)).toEqual(["g2"]);
  });

  it("puts a device with several actions in the same group once", async () => {
    const store = new InMemoryEventStore();
    await device(store, "d1", "Dup", "203.0.113.1");
    await deliveryAction(store, "a1", "d1", "p1", "g");
    await deliveryAction(store, "a2", "d1", "p1", "g");
    const group = (await buildSnapshotContent(store, ACCOUNT, "p1", "N")).groups[0];
    expect(group?.entries).toHaveLength(1);
  });

  it("falls back to the device id for an empty label", async () => {
    const store = new InMemoryEventStore();
    await device(store, "d1", "   ", "203.0.113.1");
    await deliveryAction(store, "a1", "d1", "p1", "g");
    expect((await buildSnapshotContent(store, ACCOUNT, "p1", "N")).groups[0]?.entries[0]?.deviceName).toBe("d1");
  });
});

describe("snapshotContentHash", () => {
  it("is stable for equal content and changes with content or provider name", () => {
    const a = { providerName: "N", groups: [{ key: "g", entries: [{ deviceName: "x", ips: ["1.1.1.1"] }] }] };
    expect(snapshotContentHash(a)).toBe(snapshotContentHash(structuredClone(a)));
    expect(snapshotContentHash({ ...a, providerName: "M" })).not.toBe(snapshotContentHash(a));
    expect(snapshotContentHash({ ...a, groups: [] })).not.toBe(snapshotContentHash(a));
  });

  it("estimates size from the serialized content", () => {
    expect(snapshotApproxBytes({ providerName: "N", groups: [] })).toBeGreaterThan(10);
  });
});
