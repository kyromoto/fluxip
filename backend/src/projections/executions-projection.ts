import type { Redis } from "ioredis";
import {
  actionExecutionReducer,
  initialActionExecutionState,
  type ActionExecutionState,
} from "../domain/action-execution/action-execution-aggregate.js";
import { ACTION_EXECUTION_AGGREGATE_TYPE } from "../domain/action-execution/events.js";
import { loadAggregate } from "../domain/replay.js";
import type { EventStore } from "../ports/event-store.js";

export interface ExecutionSummary {
  executionId: string;
  actionId: string;
  ipClientId: string;
  triggeredBy: ActionExecutionState["triggeredBy"];
  ipValuesUsed: ActionExecutionState["ipValuesUsed"];
  status: ActionExecutionState["status"];
  attempt: number;
  error: string | null;
}

function projectionKey(tenantId: string, actionId: string): string {
  return `proj:${tenantId}:action:${actionId}:executions`;
}

function toSummary(state: ActionExecutionState): ExecutionSummary | null {
  if (!state.executionId || !state.actionId || !state.ipClientId) return null;
  return {
    executionId: state.executionId,
    actionId: state.actionId,
    ipClientId: state.ipClientId,
    triggeredBy: state.triggeredBy,
    ipValuesUsed: state.ipValuesUsed,
    status: state.status,
    attempt: state.attempt,
    error: state.error,
  };
}

export async function upsertExecutionProjection(
  redis: Redis,
  tenantId: string,
  state: ActionExecutionState,
): Promise<void> {
  const summary = toSummary(state);
  if (!summary) return;
  await redis.hset(projectionKey(tenantId, summary.actionId), summary.executionId, JSON.stringify(summary));
}

export async function rebuildExecutionsProjection(
  redis: Redis,
  eventStore: EventStore,
  tenantId: string,
  actionId: string,
): Promise<void> {
  const allExecutionIds = await eventStore.listAggregateIds({
    tenantId,
    aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE,
  });
  const key = projectionKey(tenantId, actionId);
  await redis.del(key);

  for (const executionId of allExecutionIds) {
    const { state } = await loadAggregate(
      eventStore,
      { tenantId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: executionId },
      initialActionExecutionState,
      actionExecutionReducer,
    );
    if (state.actionId !== actionId) continue;
    const summary = toSummary(state);
    if (summary) {
      await redis.hset(key, summary.executionId, JSON.stringify(summary));
    }
  }
}

export async function listExecutionsProjection(
  redis: Redis,
  eventStore: EventStore,
  tenantId: string,
  actionId: string,
): Promise<ExecutionSummary[]> {
  const key = projectionKey(tenantId, actionId);
  const exists = await redis.exists(key);
  if (!exists) {
    await rebuildExecutionsProjection(redis, eventStore, tenantId, actionId);
  }
  const raw = await redis.hgetall(key);
  return Object.values(raw).map((v) => JSON.parse(v) as ExecutionSummary);
}
