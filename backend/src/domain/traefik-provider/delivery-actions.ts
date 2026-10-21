import type { EventStore } from "../../ports/event-store.js";
import { actionReducer, initialActionState } from "../action/action-aggregate.js";
import { ACTION_AGGREGATE_TYPE, TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE, type TraefikConfigDeliveryConfig } from "../action/events.js";
import { loadAggregate } from "../replay.js";

export interface DeliveryAction {
  actionId: string;
  ipClientId: string;
  traefikProviderId: string;
  group: string;
  status: "enabled" | "disabled";
}

/** Every non-detached Traefik delivery action of the account (replay; small scale, research.md §5). */
export async function listDeliveryActions(eventStore: EventStore, accountId: string): Promise<DeliveryAction[]> {
  const ids = await eventStore.listAggregateIds({ accountId, aggregateType: ACTION_AGGREGATE_TYPE });
  const result: DeliveryAction[] = [];
  for (const actionId of ids) {
    const { state } = await loadAggregate(
      eventStore,
      { accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
      initialActionState,
      actionReducer,
    );
    if (state.type !== TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE || state.status === "detached" || !state.ipClientId) continue;
    const config = state.config as TraefikConfigDeliveryConfig | null;
    if (!config) continue;
    result.push({
      actionId,
      ipClientId: state.ipClientId,
      traefikProviderId: config.traefikProviderId,
      group: config.group,
      status: state.status,
    });
  }
  return result;
}

/** Providers whose snapshot a change to this device can affect (FR-013). */
export async function providersOfDevice(eventStore: EventStore, accountId: string, ipClientId: string): Promise<string[]> {
  const actions = await listDeliveryActions(eventStore, accountId);
  return [...new Set(actions.filter((a) => a.ipClientId === ipClientId).map((a) => a.traefikProviderId))];
}
