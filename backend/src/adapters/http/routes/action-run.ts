import type { Queue } from "bullmq";
import { Hono } from "hono";
import { ulid } from "ulid";
import { actionReducer, initialActionState } from "../../../domain/action/action-aggregate.js";
import { ACTION_AGGREGATE_TYPE } from "../../../domain/action/events.js";
import { IP_CLIENT_AGGREGATE_TYPE } from "../../../domain/ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../../../domain/ip-client/ip-client-aggregate.js";
import { loadAggregate } from "../../../domain/replay.js";
import { getAppLogger, withOperation } from "../../../observability/app-logger.js";
import type { EventStore } from "../../../ports/event-store.js";
import type { ActionExecutionJobData } from "../../queue-bullmq/action-execution-worker.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

const logger = getAppLogger(["action-run"]);

export interface ActionRunRouteDeps {
  eventStore: EventStore;
  actionExecutionQueue: Queue<ActionExecutionJobData>;
}

/**
 * Manual re-run (FR-023): creates a fresh `action_execution` using the IP
 * Client's current last-known IP, independent of any new trigger report.
 * Unlike the ip_changed fan-out (execution-fanout-worker.ts), this always
 * enqueues a new job — there is no dedup key, since each manual click is
 * intentionally its own attempt.
 */
export function createActionRunRoutes(deps: ActionRunRouteDeps): Hono {
  const router = new Hono();

  router.post("/actions/:id/run", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");

    const { state: actionState } = await loadAggregate(
      deps.eventStore,
      { accountId: auth.accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
      initialActionState,
      actionReducer,
    );
    if (!actionState.actionId || actionState.accountId !== auth.accountId) {
      return c.json({ error: "not found" }, 404);
    }
    if (actionState.status !== "enabled" || !actionState.ipClientId) {
      return c.json({ error: "Action is not enabled" }, 409);
    }

    const { state: ipClientState } = await loadAggregate(
      deps.eventStore,
      { accountId: auth.accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: actionState.ipClientId },
      initialIpClientState,
      ipClientReducer,
    );
    if (!ipClientState.lastKnownIPv4 && !ipClientState.lastKnownIPv6) {
      return c.json({ error: "no known IP yet for this Action's IP Client" }, 409);
    }

    const executionId = ulid();
    const causationEventId = ulid();
    const jobData: ActionExecutionJobData = {
      accountId: auth.accountId,
      executionId,
      actionId,
      ipClientId: actionState.ipClientId,
      causationEventId,
      triggeredBy: "manual",
      ipValues: {
        ipv4: ipClientState.lastKnownIPv4 ?? undefined,
        ipv6: ipClientState.lastKnownIPv6 ?? undefined,
      },
    };
    await withOperation(causationEventId, async () => {
      // BullMQ custom job IDs cannot contain ":" (see execution-fanout-worker.ts).
      await deps.actionExecutionQueue.add("execute", jobData, { jobId: `exec-manual-${executionId}` });
      logger.info("Manual execution requested for action {actionId}", {
        accountId: auth.accountId,
        actionId,
        ipClientId: actionState.ipClientId,
        executionId,
      });
    });

    return c.json({ executionId }, 202);
  });

  return router;
}
