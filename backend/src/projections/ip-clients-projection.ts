import type { Redis } from "ioredis";
import {
  ipClientReducer,
  initialIpClientState,
  type IpClientState,
} from "../domain/ip-client/ip-client-aggregate.js";
import { IP_CLIENT_AGGREGATE_TYPE } from "../domain/ip-client/events.js";
import { loadAggregate } from "../domain/replay.js";
import type { EventStore } from "../ports/event-store.js";

export interface IpClientSummary {
  ipClientId: string;
  label: string;
  status: IpClientState["status"];
  lastKnownIPv4: string | null;
  lastKnownIPv6: string | null;
  notificationPreference: IpClientState["notificationPreference"];
}

function projectionKey(accountId: string): string {
  return `proj:${accountId}:ip_clients`;
}

function toSummary(state: IpClientState): IpClientSummary | null {
  if (!state.ipClientId) return null;
  return {
    ipClientId: state.ipClientId,
    label: state.label,
    status: state.status,
    lastKnownIPv4: state.lastKnownIPv4,
    lastKnownIPv6: state.lastKnownIPv6,
    notificationPreference: state.notificationPreference,
  };
}

/** Disposable read model only — never consulted for business decisions (research.md §9). */
export async function upsertIpClientProjection(
  redis: Redis,
  accountId: string,
  state: IpClientState,
): Promise<void> {
  const summary = toSummary(state);
  if (!summary) return;
  if (summary.status === "decommissioned") {
    await redis.hdel(projectionKey(accountId), summary.ipClientId);
    return;
  }
  await redis.hset(projectionKey(accountId), summary.ipClientId, JSON.stringify(summary));
}

export async function rebuildIpClientsProjection(
  redis: Redis,
  eventStore: EventStore,
  accountId: string,
): Promise<void> {
  const key = projectionKey(accountId);
  const ipClientIds = await eventStore.listAggregateIds({
    accountId,
    aggregateType: IP_CLIENT_AGGREGATE_TYPE,
  });

  await redis.del(key);
  for (const ipClientId of ipClientIds) {
    const { state } = await loadAggregate(
      eventStore,
      { accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
      initialIpClientState,
      ipClientReducer,
    );
    const summary = toSummary(state);
    if (summary && summary.status !== "decommissioned") {
      await redis.hset(key, summary.ipClientId, JSON.stringify(summary));
    }
  }
}

export async function listIpClientsProjection(
  redis: Redis,
  eventStore: EventStore,
  accountId: string,
): Promise<IpClientSummary[]> {
  const key = projectionKey(accountId);
  const exists = await redis.exists(key);
  if (!exists) {
    await rebuildIpClientsProjection(redis, eventStore, accountId);
  }
  const raw = await redis.hgetall(key);
  return Object.values(raw).map((v) => JSON.parse(v) as IpClientSummary);
}
