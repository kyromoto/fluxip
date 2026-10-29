import { Hono } from "hono";
import { actionReducer, initialActionState, type ActionState } from "../../../domain/action/action-aggregate.js";
import {
  ACTION_AGGREGATE_TYPE,
  TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE,
  type TraefikConfigDeliveryConfig,
} from "../../../domain/action/events.js";
import {
  actionExecutionReducer,
  initialActionExecutionState,
  type ActionExecutionState,
} from "../../../domain/action-execution/action-execution-aggregate.js";
import { ACTION_EXECUTION_AGGREGATE_TYPE } from "../../../domain/action-execution/events.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName } from "../../../domain/ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../../../domain/ip-client/ip-client-aggregate.js";
import { loadAggregate } from "../../../domain/replay.js";
import {
  deriveDeliveries,
  type DeliveryActionRef,
  type DeliveryProvider,
} from "../../../domain/traefik-provider/delivery-history.js";
import { TRAEFIK_PROVIDER_AGGREGATE_TYPE } from "../../../domain/traefik-provider/events.js";
import {
  initialTraefikProviderState,
  traefikProviderReducer,
} from "../../../domain/traefik-provider/traefik-provider-aggregate.js";
import type { EventStore } from "../../../ports/event-store.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface IpClientHistoryRouteDeps {
  eventStore: EventStore;
}

/** Non-secret summary of what an Action targets, so the history can say which Action ran. */
function describeAction(state: ActionState | undefined) {
  const config = (state?.config ?? {}) as Record<string, unknown>;
  return {
    type: state?.type ?? null,
    zone: typeof config.zone === "string" ? config.zone : undefined,
    recordName: typeof config.recordName === "string" ? config.recordName : undefined,
    firewallId: typeof config.firewallId === "number" ? config.firewallId : undefined,
    description: typeof config.description === "string" ? config.description : undefined,
  };
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
    const relevantActions = new Map<string, ActionState>();
    for (const actionId of actionIds) {
      const { state } = await loadAggregate(
        deps.eventStore,
        { accountId: auth.accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
        initialActionState,
        actionReducer,
      );
      if (state.ipClientId === ipClientId) relevantActions.set(actionId, state);
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
      if (state.actionId && relevantActions.has(state.actionId)) {
        executions.push(state);
      }
    }

    // Traefik delivery actions never run as executions; their delivery is derived from the provider's events
    // (specs/009). Detached actions are kept: their config survives, and what they delivered stays true.
    const deliveryActions: DeliveryActionRef[] = [];
    for (const [actionId, state] of relevantActions) {
      if (state.type !== TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE) continue;
      const config = state.config as TraefikConfigDeliveryConfig | null;
      if (config) deliveryActions.push({ actionId, traefikProviderId: config.traefikProviderId, group: config.group });
    }
    const providers = new Map<string, DeliveryProvider>();
    for (const providerId of new Set(deliveryActions.map((a) => a.traefikProviderId))) {
      const { state, events: providerEvents } = await loadAggregate(
        deps.eventStore,
        { accountId: auth.accountId, aggregateType: TRAEFIK_PROVIDER_AGGREGATE_TYPE, aggregateId: providerId },
        initialTraefikProviderState,
        traefikProviderReducer,
      );
      const active = state.providerId === providerId && state.accountId === auth.accountId && state.status === "active";
      providers.set(providerId, { name: active ? state.name : null, events: providerEvents });
    }
    const deliveries = deriveDeliveries({
      ipChangedEventIds: ipChangedEvents.map((e) => e.id),
      actions: deliveryActions,
      providers,
    });

    const items = ipChangedEvents.map((event) => ({
      ipChangedEventId: event.id,
      time: event.time,
      data: event.data,
      deliveries: deliveries.get(event.id) ?? [],
      executions: executions
        .filter((ex) => ex.causationEventId === event.id)
        .map((ex) => ({
          executionId: ex.executionId,
          actionId: ex.actionId,
          action: describeAction(ex.actionId ? relevantActions.get(ex.actionId) : undefined),
          status: ex.status,
          attempt: ex.attempt,
          error: ex.error,
          startedAt: ex.startedAt,
          completedAt: ex.completedAt,
          failedAt: ex.failedAt,
        })),
    }));

    return c.json({ items });
  });

  return router;
}
