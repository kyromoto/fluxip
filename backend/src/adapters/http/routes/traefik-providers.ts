import { Hono } from "hono";
import { ulid } from "ulid";
import type { Config } from "../../../config/env.js";
import { listDeliveryActions } from "../../../domain/traefik-provider/delivery-actions.js";
import {
  TraefikProviderEventName,
  type ConnectionMode,
  type TraefikProviderCreatedData,
  type TraefikProviderDeletedData,
  type TraefikProviderRenamedData,
  type TraefikProviderTokenIssuedData,
  type TraefikProviderTokenRevokedData,
} from "../../../domain/traefik-provider/events.js";
import type { ProviderStore } from "../../../domain/traefik-provider/provider-store.js";
import { MAX_ACTIVE_TOKENS, activeTokens, type TraefikProviderState } from "../../../domain/traefik-provider/traefik-provider-aggregate.js";
import { generateAgentToken } from "../../../domain/traefik-provider/token.js";
import { IP_CLIENT_AGGREGATE_TYPE } from "../../../domain/ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../../../domain/ip-client/ip-client-aggregate.js";
import { loadAggregate } from "../../../domain/replay.js";
import type { EventStore } from "../../../ports/event-store.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";
import type { SessionRegistry } from "../../agent-grpc/session-registry.js";

export interface TraefikProvidersRouteDeps {
  config: Config;
  eventStore: EventStore;
  store: ProviderStore;
  registry: SessionRegistry;
}

const NAME_MAX = 100;
const NOTICE_WINDOW_MS = 24 * 3600 * 1000;
/** A backend restart loses the live sessions without a disconnect event; offline time is then counted from here. */
const PROCESS_STARTED_AT = Date.now();

export type ProviderConnectionState = "never_connected" | "connected" | "disconnected" | "stale";

/** research.md §10: stale = disconnected for longer than the agent's own maximum offline duration. */
export function deriveConnectionState(state: TraefikProviderState, connected: boolean, now = Date.now()): ProviderConnectionState {
  if (connected) return "connected";
  if (!state.lastConnectedAt) return "never_connected";
  const maxOffline = (state.maxOfflineSeconds ?? 0) * 1000;
  if (maxOffline <= 0) return "disconnected";
  const explicit = state.lastDisconnectedAt ? Date.parse(state.lastDisconnectedAt) : 0;
  let since = Math.max(explicit, Date.parse(state.lastConnectedAt));
  if (state.lastPresence === "connected") since = Math.max(since, PROCESS_STARTED_AT);
  return now - since > maxOffline ? "stale" : "disconnected";
}

function agentAddress(config: Config, providerId: string): string {
  return `${config.agentPublicUrl}/${providerId}`;
}

function startCommand(address: string, token: string): string {
  return [
    `FLUXIP_ADDRESS=${address}`,
    `FLUXIP_TOKEN=${token}`,
    "FLUXIP_TEMPLATES_DIR=/etc/fluxip-agent/templates",
    "FLUXIP_OUTPUT_DIR=/etc/traefik/dynamic",
    "fluxip-agent run",
  ].join(" \\\n  ");
}

const TRAEFIK_SNIPPET = "providers:\n  file:\n    directory: /etc/traefik/dynamic\n    watch: true\n";

function setupFor(address: string, token: string): Record<string, unknown> {
  return {
    startCommand: startCommand(address, token),
    traefikSnippet: TRAEFIK_SNIPPET,
    notes: [
      "Remove any hand-written definition of a middleware or service with the same name, otherwise Traefik reports a name conflict.",
      "Write the example templates with `fluxip-agent templates --write /etc/fluxip-agent/templates` and adapt them.",
      "Use FLUXIP_TOKEN_FILE instead of FLUXIP_TOKEN to keep the token out of the process list.",
    ],
  };
}

function tokenView(state: TraefikProviderState) {
  return state.tokens.map((token) => ({
    tokenId: token.tokenId,
    last4: token.last4,
    issuedAt: token.issuedAt,
    status: token.revokedAt ? "revoked" : "valid",
  }));
}

export function createTraefikProvidersRoutes(deps: TraefikProvidersRouteDeps): Hono {
  const router = new Hono();

  function view(state: TraefikProviderState, actionCount: number) {
    const connected = deps.registry.isConnected(state.providerId ?? "");
    const notices: string[] = [];
    if (state.replacedPreviousAt && Date.now() - Date.parse(state.replacedPreviousAt) < NOTICE_WINDOW_MS) {
      notices.push("previous_session_superseded");
    }
    return {
      providerId: state.providerId,
      name: state.name,
      connectionMode: state.connectionMode,
      agentAddress: agentAddress(deps.config, state.providerId ?? ""),
      state: deriveConnectionState(state, connected),
      lastConnectedAt: state.lastConnectedAt,
      lastDisconnectedAt: state.lastDisconnectedAt,
      appliedVersion: state.lastApplied?.version ?? null,
      publishedVersion: state.lastPublished?.version ?? null,
      agentVersion: state.agentVersion,
      lastError: state.lastApplyError
        ? { version: state.lastApplyError.version, reason: state.lastApplyError.reason, at: state.lastApplyError.appliedAt }
        : null,
      lastPublishError: state.lastPublishError
        ? { reason: state.lastPublishError.reason, at: state.lastPublishError.failedAt }
        : null,
      notices,
      tokens: tokenView(state),
      actionCount,
    };
  }

  router.post("/", async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json<{ name?: string; connectionMode?: string }>().catch(() => ({}) as Record<string, never>);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > NAME_MAX) return c.json({ error: "name is required (max 100 characters)" }, 400);

    const connectionMode = (body.connectionMode ?? "agent_initiated") as ConnectionMode;
    if (connectionMode !== "agent_initiated") {
      return c.json(
        {
          error: "connection_mode_not_available",
          message: "Only the connection mode 'agent connects to FluxIP' (agent_initiated) is available.",
        },
        422,
      );
    }
    if (!deps.config.agentPublicUrl) {
      return c.json({ error: "agent_public_url_not_configured", message: "BACKEND_AGENT_PUBLIC_URL is not set on this FluxIP deployment." }, 422);
    }

    const existing = await deps.store.listActive(auth.accountId);
    if (existing.some((p) => p.state.name.trim().toLowerCase() === name.toLowerCase())) {
      return c.json({ error: "name_in_use" }, 409);
    }

    const providerId = deps.store.newProviderId();
    const created: TraefikProviderCreatedData = {
      providerId,
      accountId: auth.accountId,
      name,
      connectionMode,
      createdAt: new Date().toISOString(),
    };
    await deps.store.append(auth.accountId, providerId, TraefikProviderEventName.Created, created);

    const token = generateAgentToken();
    const tokenId = ulid();
    const issued: TraefikProviderTokenIssuedData = {
      tokenId,
      tokenHash: token.hash,
      last4: token.last4,
      issuedAt: new Date().toISOString(),
    };
    await deps.store.append(auth.accountId, providerId, TraefikProviderEventName.TokenIssued, issued);

    const address = agentAddress(deps.config, providerId);
    return c.json(
      {
        providerId,
        name,
        connectionMode,
        agentAddress: address,
        token: { tokenId, value: token.plaintext, last4: token.last4 },
        setup: setupFor(address, token.plaintext),
      },
      201,
    );
  });

  router.get("/", async (c) => {
    const auth = getAuth(c);
    const [providers, actions] = await Promise.all([deps.store.listActive(auth.accountId), listDeliveryActions(deps.eventStore, auth.accountId)]);
    const items = providers.map(({ state }) =>
      view(state, actions.filter((a) => a.traefikProviderId === state.providerId).length),
    );
    return c.json({ items });
  });

  router.get("/:id", async (c) => {
    const auth = getAuth(c);
    const providerId = c.req.param("id");
    const loaded = await deps.store.loadActive(auth.accountId, providerId);
    if (!loaded) return c.json({ error: "not found" }, 404);

    const actions = (await listDeliveryActions(deps.eventStore, auth.accountId)).filter((a) => a.traefikProviderId === providerId);
    const usedBy = [];
    for (const action of actions) {
      const { state } = await loadAggregate(
        deps.eventStore,
        { accountId: auth.accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: action.ipClientId },
        initialIpClientState,
        ipClientReducer,
      );
      usedBy.push({ actionId: action.actionId, ipClientId: action.ipClientId, ipClientName: state.label, group: action.group, status: action.status });
    }
    return c.json({
      ...view(loaded.state, actions.length),
      usedBy,
      groups: [...new Set(actions.map((a) => a.group))].sort(),
    });
  });

  router.patch("/:id", async (c) => {
    const auth = getAuth(c);
    const providerId = c.req.param("id");
    const loaded = await deps.store.loadActive(auth.accountId, providerId);
    if (!loaded) return c.json({ error: "not found" }, 404);

    const body = await c.req.json<{ name?: string; connectionMode?: string }>().catch(() => ({}) as Record<string, never>);
    if (body.connectionMode !== undefined && body.connectionMode !== loaded.state.connectionMode) {
      return c.json({ error: "immutable_field", field: "connectionMode" }, 422);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > NAME_MAX) return c.json({ error: "name is required (max 100 characters)" }, 400);

    const others = (await deps.store.listActive(auth.accountId)).filter((p) => p.state.providerId !== providerId);
    if (others.some((p) => p.state.name.trim().toLowerCase() === name.toLowerCase())) {
      return c.json({ error: "name_in_use" }, 409);
    }
    if (name !== loaded.state.name) {
      const data: TraefikProviderRenamedData = { name, renamedAt: new Date().toISOString() };
      await deps.store.append(auth.accountId, providerId, TraefikProviderEventName.Renamed, data);
    }
    const fresh = await deps.store.load(auth.accountId, providerId);
    const actions = (await listDeliveryActions(deps.eventStore, auth.accountId)).filter((a) => a.traefikProviderId === providerId);
    return c.json(view(fresh.state, actions.length));
  });

  router.delete("/:id", async (c) => {
    const auth = getAuth(c);
    const providerId = c.req.param("id");
    const loaded = await deps.store.loadActive(auth.accountId, providerId);
    if (!loaded) return c.json({ error: "not found" }, 404);

    const usedBy = (await listDeliveryActions(deps.eventStore, auth.accountId))
      .filter((a) => a.traefikProviderId === providerId)
      .map((a) => ({ actionId: a.actionId, ipClientId: a.ipClientId, group: a.group }));
    if (usedBy.length > 0) return c.json({ error: "traefik_provider_in_use", usedBy }, 409);

    const data: TraefikProviderDeletedData = { deletedAt: new Date().toISOString() };
    await deps.store.append(auth.accountId, providerId, TraefikProviderEventName.Deleted, data);
    deps.registry.terminateByProvider(providerId, { code: "unauthenticated", message: "this agent address was deleted", disconnect: "revoked" });
    return c.body(null, 204);
  });

  router.post("/:id/tokens", async (c) => {
    const auth = getAuth(c);
    const providerId = c.req.param("id");
    const loaded = await deps.store.loadActive(auth.accountId, providerId);
    if (!loaded) return c.json({ error: "not found" }, 404);
    if (activeTokens(loaded.state).length >= MAX_ACTIVE_TOKENS) {
      return c.json({ error: "token_limit_reached", message: "Revoke one of the two valid tokens first." }, 409);
    }
    const token = generateAgentToken();
    const tokenId = ulid();
    const data: TraefikProviderTokenIssuedData = {
      tokenId,
      tokenHash: token.hash,
      last4: token.last4,
      issuedAt: new Date().toISOString(),
    };
    await deps.store.append(auth.accountId, providerId, TraefikProviderEventName.TokenIssued, data);
    return c.json({ tokenId, value: token.plaintext, last4: token.last4 }, 201);
  });

  router.delete("/:id/tokens/:tokenId", async (c) => {
    const auth = getAuth(c);
    const providerId = c.req.param("id");
    const tokenId = c.req.param("tokenId");
    const loaded = await deps.store.loadActive(auth.accountId, providerId);
    if (!loaded) return c.json({ error: "not found" }, 404);
    const token = loaded.state.tokens.find((t) => t.tokenId === tokenId);
    if (!token) return c.json({ error: "not found" }, 404);
    if (!token.revokedAt) {
      const data: TraefikProviderTokenRevokedData = { tokenId, revokedAt: new Date().toISOString() };
      await deps.store.append(auth.accountId, providerId, TraefikProviderEventName.TokenRevoked, data);
    }
    deps.registry.terminateByToken(providerId, tokenId, {
      code: "unauthenticated",
      message: AUTH_REVOKED_MESSAGE,
      disconnect: "revoked",
    });
    return c.body(null, 204);
  });

  return router;
}

const AUTH_REVOKED_MESSAGE = "invalid or revoked token for this agent address";
