import { Hono } from "hono";
import type { Redis } from "ioredis";
import { actionReducer, initialActionState } from "../../../domain/action/action-aggregate.js";
import { ACTION_AGGREGATE_TYPE } from "../../../domain/action/events.js";
import { loadAggregate } from "../../../domain/replay.js";
import type { EventStore } from "../../../ports/event-store.js";
import { listExecutionsProjection } from "../../../projections/executions-projection.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface ActionExecutionsRouteDeps {
  eventStore: EventStore;
  redis: Redis;
}

export function createActionExecutionsRoutes(deps: ActionExecutionsRouteDeps): Hono {
  const router = new Hono();

  router.get("/actions/:actionId/executions", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("actionId");

    const { state } = await loadAggregate(
      deps.eventStore,
      { accountId: auth.accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
      initialActionState,
      actionReducer,
    );
    // Not found (rather than 403) if it isn't this account's Action — avoids confirming existence (FR-013/SC-003).
    if (!state.actionId || state.accountId !== auth.accountId) {
      return c.json({ error: "not_found" }, 404);
    }

    const items = await listExecutionsProjection(deps.redis, deps.eventStore, auth.accountId, actionId);
    return c.json({ items });
  });

  return router;
}
