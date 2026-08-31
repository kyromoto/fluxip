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

function projectionKey(accountId: string, actionId: string): string {
  return `proj:${accountId}:action:${actionId}:executions`;
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
  accountId: string,
  state: ActionExecutionState,
): Promise<void> {
  const summary = toSummary(state);
  if (!summary) return;
  await redis.hset(projectionKey(accountId, summary.actionId), summary.executionId, JSON.stringify(summary));
}

export async function rebuildExecutionsProjection(
  redis: Redis,
  eventStore: EventStore,
  accountId: string,
  actionId: string,
): Promise<void> {
  const allExecutionIds = await eventStore.listAggregateIds({
    accountId,
    aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE,
  });
  const key = projectionKey(accountId, actionId);
  await redis.del(key);

  for (const executionId of allExecutionIds) {
    const { state } = await loadAggregate(
      eventStore,
      { accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: executionId },
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
  accountId: string,
  actionId: string,
): Promise<ExecutionSummary[]> {
  const key = projectionKey(accountId, actionId);
  const exists = await redis.exists(key);
  if (!exists) {
    await rebuildExecutionsProjection(redis, eventStore, accountId, actionId);
  }
  const raw = await redis.hgetall(key);
  return Object.values(raw).map((v) => JSON.parse(v) as ExecutionSummary);
}
