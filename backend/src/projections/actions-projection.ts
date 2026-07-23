import type { Redis } from "ioredis";
import { ACTION_AGGREGATE_TYPE } from "../domain/action/events.js";
import { actionReducer, initialActionState, type ActionState } from "../domain/action/action-aggregate.js";
import { loadAggregate } from "../domain/replay.js";
import type { EventStore } from "../ports/event-store.js";

export interface ActionSummary {
  actionId: string;
  ipClientId: string;
  type: string;
  addressFamilies: ActionState["addressFamilies"];
  config: ActionState["config"];
  status: ActionState["status"];
}

function projectionKey(tenantId: string, ipClientId: string): string {
  return `proj:${tenantId}:ip_client:${ipClientId}:actions`;
}

function toSummary(state: ActionState): ActionSummary | null {
  if (!state.actionId || !state.ipClientId || !state.type) return null;
  return {
    actionId: state.actionId,
    ipClientId: state.ipClientId,
    type: state.type,
    addressFamilies: state.addressFamilies,
    config: state.config,
    status: state.status,
  };
}

export async function upsertActionProjection(redis: Redis, tenantId: string, state: ActionState): Promise<void> {
  const summary = toSummary(state);
  if (!summary) return;
  const key = projectionKey(tenantId, summary.ipClientId);
  if (summary.status === "detached") {
    await redis.hdel(key, summary.actionId);
    return;
  }
  await redis.hset(key, summary.actionId, JSON.stringify(summary));
}

export async function rebuildActionsProjection(
  redis: Redis,
  eventStore: EventStore,
  tenantId: string,
  ipClientId: string,
): Promise<void> {
  const allActionIds = await eventStore.listAggregateIds({ tenantId, aggregateType: ACTION_AGGREGATE_TYPE });
  const key = projectionKey(tenantId, ipClientId);
  await redis.del(key);

  for (const actionId of allActionIds) {
    const { state } = await loadAggregate(
      eventStore,
      { tenantId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
      initialActionState,
      actionReducer,
    );
    if (state.ipClientId !== ipClientId) continue;
    const summary = toSummary(state);
    if (summary && summary.status !== "detached") {
      await redis.hset(key, summary.actionId, JSON.stringify(summary));
    }
  }
}

export async function listActionsProjection(
  redis: Redis,
  eventStore: EventStore,
  tenantId: string,
  ipClientId: string,
): Promise<ActionSummary[]> {
  const key = projectionKey(tenantId, ipClientId);
  const exists = await redis.exists(key);
  if (!exists) {
    await rebuildActionsProjection(redis, eventStore, tenantId, ipClientId);
  }
  const raw = await redis.hgetall(key);
  return Object.values(raw).map((v) => JSON.parse(v) as ActionSummary);
}
