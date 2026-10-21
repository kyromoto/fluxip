import { createHash } from "node:crypto";
import type { EventStore } from "../../ports/event-store.js";
import { actionReducer, initialActionState } from "../action/action-aggregate.js";
import { ACTION_AGGREGATE_TYPE, TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE, type TraefikConfigDeliveryConfig } from "../action/events.js";
import { IP_CLIENT_AGGREGATE_TYPE } from "../ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../ip-client/ip-client-aggregate.js";
import { loadAggregate } from "../replay.js";

export interface SnapshotEntry {
  deviceName: string;
  ips: string[];
}

export interface SnapshotGroup {
  key: string;
  entries: SnapshotEntry[];
}

/** The part of a snapshot that is derived from account state; version/time/correlation are added when it is published. */
export interface SnapshotContent {
  providerName: string;
  groups: SnapshotGroup[];
}

export interface SnapshotPayload extends SnapshotContent {
  version: number;
  correlationId: string;
  generatedAt: string;
}

/**
 * The complete state of one provider (FR-020): every enabled delivery action pointing at it, joined with
 * its enabled device's current IPs. Devices without any known IP produce no entry (FR-012). Output is
 * sorted so equal states always serialize — and hash — identically.
 */
export async function buildSnapshotContent(
  eventStore: EventStore,
  accountId: string,
  providerId: string,
  providerName: string,
): Promise<SnapshotContent> {
  const actionIds = await eventStore.listAggregateIds({ accountId, aggregateType: ACTION_AGGREGATE_TYPE });

  const members: { group: string; ipClientId: string }[] = [];
  for (const actionId of actionIds) {
    const { state } = await loadAggregate(
      eventStore,
      { accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
      initialActionState,
      actionReducer,
    );
    if (state.type !== TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE || state.status !== "enabled" || !state.ipClientId) continue;
    const config = state.config as TraefikConfigDeliveryConfig | null;
    if (!config || config.traefikProviderId !== providerId) continue;
    members.push({ group: config.group, ipClientId: state.ipClientId });
  }

  const deviceCache = new Map<string, { label: string; ips: string[] } | null>();
  async function device(ipClientId: string): Promise<{ label: string; ips: string[] } | null> {
    if (deviceCache.has(ipClientId)) return deviceCache.get(ipClientId) ?? null;
    const { state } = await loadAggregate(
      eventStore,
      { accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
      initialIpClientState,
      ipClientReducer,
    );
    const ips = [state.lastKnownIPv4, state.lastKnownIPv6].filter((ip): ip is string => !!ip);
    const usable = state.status === "enabled" && ips.length > 0;
    const value = usable ? { label: state.label.trim() || ipClientId, ips } : null;
    deviceCache.set(ipClientId, value);
    return value;
  }

  const byGroup = new Map<string, Map<string, { deviceName: string; ips: string[] }>>();
  for (const member of members) {
    const info = await device(member.ipClientId);
    if (!info) continue;
    const entries = byGroup.get(member.group) ?? new Map();
    entries.set(member.ipClientId, { deviceName: info.label, ips: info.ips });
    byGroup.set(member.group, entries);
  }

  const groups: SnapshotGroup[] = [...byGroup.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entries]) => ({
      key,
      entries: [...entries.entries()]
        .sort(([idA, a], [idB, b]) => a.deviceName.localeCompare(b.deviceName) || (idA < idB ? -1 : idA > idB ? 1 : 0))
        .map(([, entry]) => entry),
    }));

  return { providerName, groups };
}

/** SHA-256 over the canonical JSON of the content (research.md §3: equal hash ⇒ nothing to publish). */
export function snapshotContentHash(content: SnapshotContent): string {
  return createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex");
}

export function snapshotCounts(content: SnapshotContent): { groupCount: number; entryCount: number } {
  return {
    groupCount: content.groups.length,
    entryCount: content.groups.reduce((sum, group) => sum + group.entries.length, 0),
  };
}

/** Approximate wire size used for the FR-024 limit; the protobuf encoding is never larger than the JSON form. */
export function snapshotApproxBytes(content: SnapshotContent): number {
  return Buffer.byteLength(JSON.stringify(content), "utf8");
}
