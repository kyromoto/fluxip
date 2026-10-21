import { Hono } from "hono";
import { listDeliveryActions } from "../../../domain/traefik-provider/delivery-actions.js";
import type { ProviderStore } from "../../../domain/traefik-provider/provider-store.js";
import type { TraefikProviderState } from "../../../domain/traefik-provider/traefik-provider-aggregate.js";
import type { EventStore } from "../../../ports/event-store.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";
import type { SessionRegistry } from "../../agent-grpc/session-registry.js";
import { deriveConnectionState } from "./traefik-providers.js";

export interface DeliveryStatusRouteDeps {
  eventStore: EventStore;
  store: ProviderStore;
  registry: SessionRegistry;
}

export type DeliveryStatus = "applied" | "pending" | "error" | "agent_disconnected" | "disabled";

/**
 * research.md §12: the agent reports versions, not contents, so an action's status follows its provider's
 * state at the currently published version.
 */
export function deriveDeliveryStatus(state: TraefikProviderState, connected: boolean, actionEnabled: boolean): DeliveryStatus {
  if (!actionEnabled) return "disabled";
  if (deriveConnectionState(state, connected) !== "connected") return "agent_disconnected";
  const published = state.lastPublished?.version ?? null;
  if (published === null) return "pending";
  if (state.lastApplyError && state.lastApplyError.version >= published) return "error";
  if (state.lastApplied && state.lastApplied.version >= published) return "applied";
  return "pending";
}

/** Delivery status lives in its own endpoint on purpose: the actions list is a Redis projection that must not hold it (research.md §5). */
export function createDeliveryStatusRoutes(deps: DeliveryStatusRouteDeps): Hono {
  const router = new Hono();

  router.get("/ip-clients/:ipClientId/delivery-status", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("ipClientId");
    const actions = (await listDeliveryActions(deps.eventStore, auth.accountId)).filter((a) => a.ipClientId === ipClientId);

    const items = [];
    for (const action of actions) {
      const loaded = await deps.store.loadActive(auth.accountId, action.traefikProviderId);
      if (!loaded) continue;
      const { state } = loaded;
      const status = deriveDeliveryStatus(state, deps.registry.isConnected(action.traefikProviderId), action.status === "enabled");
      items.push({
        actionId: action.actionId,
        traefikProviderId: action.traefikProviderId,
        providerName: state.name,
        group: action.group,
        status,
        publishedVersion: state.lastPublished?.version ?? null,
        appliedVersion: state.lastApplied?.version ?? null,
        error:
          status === "error" && state.lastApplyError
            ? { reason: state.lastApplyError.reason, at: state.lastApplyError.appliedAt }
            : null,
      });
    }
    return c.json({ items });
  });

  return router;
}
