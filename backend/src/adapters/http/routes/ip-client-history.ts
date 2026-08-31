import { Hono } from "hono";
import { actionReducer, initialActionState } from "../../../domain/action/action-aggregate.js";
import { ACTION_AGGREGATE_TYPE } from "../../../domain/action/events.js";
import {
  actionExecutionReducer,
  initialActionExecutionState,
  type ActionExecutionState,
} from "../../../domain/action-execution/action-execution-aggregate.js";
import { ACTION_EXECUTION_AGGREGATE_TYPE } from "../../../domain/action-execution/events.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName } from "../../../domain/ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../../../domain/ip-client/ip-client-aggregate.js";
import { loadAggregate } from "../../../domain/replay.js";
import type { EventStore } from "../../../ports/event-store.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface IpClientHistoryRouteDeps {
  eventStore: EventStore;
}

export function createIpClientHistoryRoutes(deps: IpClientHistoryRouteDeps): Hono {
  const router = new Hono();

  router.get("/ip-clients/:id/history", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("id");

    const { state: ipClientState, events } = await loadAggregate(
      deps.eventStore,
      { accountId: auth.accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
      initialIpClientState,
      ipClientReducer,
    );
    if (!ipClientState.ipClientId || ipClientState.accountId !== auth.accountId) {
      return c.json({ error: "not found" }, 404);
    }

    const ipChangedEvents = events.filter((e) => e.eventName === IpClientEventName.IpChanged);

    const actionIds = await deps.eventStore.listAggregateIds({
      accountId: auth.accountId,
      aggregateType: ACTION_AGGREGATE_TYPE,
    });
    const relevantActionIds = new Set<string>();
    for (const actionId of actionIds) {
      const { state } = await loadAggregate(
        deps.eventStore,
        { accountId: auth.accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
        initialActionState,
        actionReducer,
      );
      if (state.ipClientId === ipClientId) relevantActionIds.add(actionId);
    }

    const executionIds = await deps.eventStore.listAggregateIds({
      accountId: auth.accountId,
      aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE,
    });
    const executions: ActionExecutionState[] = [];
    for (const executionId of executionIds) {
      const { state } = await loadAggregate(
        deps.eventStore,
        { accountId: auth.accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: executionId },
        initialActionExecutionState,
        actionExecutionReducer,
      );
      if (state.actionId && relevantActionIds.has(state.actionId)) {
        executions.push(state);
      }
    }

    const items = ipChangedEvents.map((event) => ({
      ipChangedEventId: event.id,
      time: event.time,
      data: event.data,
      executions: executions
        .filter((ex) => ex.causationEventId === event.id)
        .map((ex) => ({
          executionId: ex.executionId,
          actionId: ex.actionId,
          status: ex.status,
          attempt: ex.attempt,
          error: ex.error,
        })),
    }));

    return c.json({ items });
  });

  return router;
}
