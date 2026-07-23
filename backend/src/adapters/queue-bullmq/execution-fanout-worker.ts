import type { Queue } from "bullmq";
import { ulid } from "ulid";
import { actionReducer, initialActionState } from "../../domain/action/action-aggregate.js";
import { ACTION_AGGREGATE_TYPE } from "../../domain/action/events.js";
import type { IpValuesUsed, TriggeredBy } from "../../domain/action-execution/events.js";
import { loadAggregate } from "../../domain/replay.js";
import { getAppLogger } from "../../observability/app-logger.js";
import type { EventStore } from "../../ports/event-store.js";
import type { ActionExecutionJobData } from "./action-execution-worker.js";

const logger = getAppLogger(["execution-fanout"]);

/**
 * On a settled ip_changed, enqueues one execution job per enabled Action on
 * that IP Client — each with a deterministic job ID so re-running this
 * function for the same causation event is idempotent (FR-014), and each
 * Action executes independently of the others (FR-022).
 */
export async function fanOutActionExecutions(
  eventStore: EventStore,
  actionExecutionQueue: Queue<ActionExecutionJobData>,
  params: {
    tenantId: string;
    ipClientId: string;
    causationEventId: string;
    triggeredBy: TriggeredBy;
    ipValues: IpValuesUsed;
  },
): Promise<void> {
  const actionIds = await eventStore.listAggregateIds({
    tenantId: params.tenantId,
    aggregateType: ACTION_AGGREGATE_TYPE,
  });

  for (const actionId of actionIds) {
    const { state } = await loadAggregate(
      eventStore,
      { tenantId: params.tenantId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
      initialActionState,
      actionReducer,
    );
    if (state.ipClientId !== params.ipClientId || state.status !== "enabled") continue;

    // BullMQ custom job IDs cannot contain ":" (it uses colons as its own Redis key separator).
    const jobId = `exec-${params.causationEventId}-${actionId}`;
    const executionId = ulid();
    await actionExecutionQueue.add(
      "execute",
      {
        tenantId: params.tenantId,
        executionId,
        actionId,
        ipClientId: params.ipClientId,
        causationEventId: params.causationEventId,
        triggeredBy: params.triggeredBy,
        ipValues: params.ipValues,
      },
      { jobId },
    );

    logger.info("Execution enqueued for action {actionId}", {
      tenantId: params.tenantId,
      ipClientId: params.ipClientId,
      actionId,
      executionId,
    });
  }
}
