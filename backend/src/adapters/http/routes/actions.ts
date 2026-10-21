import { Hono } from "hono";
import type { Redis } from "ioredis";
import { ulid } from "ulid";
import type { Config } from "../../../config/env.js";
import { actionReducer, initialActionState, type ActionState } from "../../../domain/action/action-aggregate.js";
import {
  ACTION_AGGREGATE_TYPE,
  ActionEventName,
  HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE,
  HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE,
  TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE,
  hasProviderCredential,
  type ActionAttachedData,
  type ActionConfig,
  type ActionDetachedData,
  type ActionDisabledData,
  type ActionEnabledData,
  type ActionReconfiguredData,
  type AddressFamily,
  type TraefikConfigDeliveryConfig,
  type UpdateDnsRecordConfig,
  type UpdateFirewallRuleConfig,
} from "../../../domain/action/events.js";
import { matchFirewallRule } from "../../../domain/action/firewall-rule-selector.js";
import { buildDomainEvent } from "../../../domain/cloud-events.js";
import {
  initialProviderCredentialState,
  providerCredentialReducer,
} from "../../../domain/provider-credential/provider-credential-aggregate.js";
import { listDeliveryActions } from "../../../domain/traefik-provider/delivery-actions.js";
import type { ProviderStore } from "../../../domain/traefik-provider/provider-store.js";
import { GROUP_PATTERN, type SnapshotScheduler } from "../../../domain/traefik-provider/snapshot-scheduler.js";
import { IP_CLIENT_AGGREGATE_TYPE } from "../../../domain/ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../../../domain/ip-client/ip-client-aggregate.js";
import { PROVIDER_CREDENTIAL_AGGREGATE_TYPE } from "../../../domain/provider-credential/events.js";
import { decryptSecret } from "../../../domain/provider-credential/secret-encryption.js";
import { loadAggregate } from "../../../domain/replay.js";
import { getAppLogger } from "../../../observability/app-logger.js";
import type { EventStore } from "../../../ports/event-store.js";
import { listActionsProjection, upsertActionProjection } from "../../../projections/actions-projection.js";
import { applyFirewallRuleUpdate } from "../../actions/hetzner-firewall/hetzner-firewall-executor.js";
import { getFirewall } from "../../actions/hetzner-firewall/hetzner-firewall-client.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

const logger = getAppLogger(["actions-route"]);

export interface ActionsRouteDeps {
  config: Config;
  eventStore: EventStore;
  redis: Redis;
  /** Needed for Traefik delivery actions (validation of the target provider). */
  providerStore?: ProviderStore;
  /** Asks for provider snapshots to be recomputed after an action change (FR-013). */
  snapshots?: SnapshotScheduler;
}

/** Providers whose snapshot an action change affects: the action's current one, plus the previous one on a move. */
async function scheduleDelivery(deps: ActionsRouteDeps, accountId: string, ...states: (ActionState | null)[]): Promise<void> {
  if (!deps.snapshots) return;
  const ids = new Set<string>();
  for (const state of states) {
    if (state?.type === TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE && state.config && "traefikProviderId" in state.config) {
      ids.add(state.config.traefikProviderId);
    }
  }
  if (ids.size > 0) await deps.snapshots.schedule(accountId, [...ids]);
}

async function currentState(deps: ActionsRouteDeps, accountId: string, actionId: string): Promise<ActionState> {
  const { state } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
    initialActionState,
    actionReducer,
  );
  return state;
}

type DeliveryValidation = { ok: true; config: TraefikConfigDeliveryConfig } | { ok: false; status: 404 | 409 | 422 | 500; body: Record<string, unknown> };

/**
 * FR-004/FR-010/FR-011: the provider must be an active one of this account, the group well-formed, and a
 * device may deliver to a given provider through at most one (non-detached) action.
 */
async function validateDeliveryConfig(
  deps: ActionsRouteDeps,
  accountId: string,
  ipClientId: string,
  raw: unknown,
  ignoreActionId?: string,
): Promise<DeliveryValidation> {
  if (!deps.providerStore) return { ok: false, status: 500, body: { error: "traefik providers are not available" } };
  const candidate = (raw ?? {}) as Partial<TraefikConfigDeliveryConfig>;
  const traefikProviderId = typeof candidate.traefikProviderId === "string" ? candidate.traefikProviderId : "";
  const group = typeof candidate.group === "string" ? candidate.group.trim() : "";
  if (!traefikProviderId) return { ok: false, status: 422, body: { error: "config.traefikProviderId is required" } };
  if (!GROUP_PATTERN.test(group)) {
    return {
      ok: false,
      status: 422,
      body: { error: "invalid_group", message: "A group is 1-63 characters: lowercase letters, digits, '.', '_' or '-', starting with a letter or digit." },
    };
  }
  const provider = await deps.providerStore.loadActive(accountId, traefikProviderId);
  if (!provider) return { ok: false, status: 404, body: { error: "traefik_provider_not_found" } };

  const existing = await listDeliveryActions(deps.eventStore, accountId);
  const clash = existing.find((a) => a.ipClientId === ipClientId && a.traefikProviderId === traefikProviderId && a.actionId !== ignoreActionId);
  if (clash) {
    return {
      ok: false,
      status: 409,
      body: { error: "delivery_action_exists", message: "This device already delivers to this provider.", actionId: clash.actionId },
    };
  }
  return { ok: true, config: { traefikProviderId, group } };
}

async function refreshProjection(deps: ActionsRouteDeps, accountId: string, actionId: string): Promise<void> {
  const { state } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
    initialActionState,
    actionReducer,
  );
  await upsertActionProjection(deps.redis, accountId, state);
}

/** Loads the Action and returns its state+version only if owned by this account, else null (404 — FR-013/SC-003). */
async function loadOwnedAction(
  deps: ActionsRouteDeps,
  accountId: string,
  actionId: string,
): Promise<{ state: ActionState; version: number } | null> {
  const { state, version } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
    initialActionState,
    actionReducer,
  );
  if (!state.actionId || state.accountId !== accountId) return null;
  return { state, version };
}

/** Loads a Provider Credential and returns its decrypted token only if owned, active, and present (FR-013). */
async function loadOwnedActiveCredential(
  deps: ActionsRouteDeps,
  accountId: string,
  credentialId: string | undefined,
): Promise<{ apiToken: string } | null> {
  if (!credentialId) return null;
  const { state: credentialState } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE, aggregateId: credentialId },
    initialProviderCredentialState,
    providerCredentialReducer,
  );
  if (
    !credentialState.credentialId ||
    credentialState.accountId !== accountId ||
    credentialState.status !== "active" ||
    !credentialState.encryptedSecret
  ) {
    return null;
  }
  return { apiToken: decryptSecret(credentialState.encryptedSecret, deps.config.credentialEncryptionKey) };
}

/**
 * FR-018: validated eagerly at configuration time (attach and reconfigure), not deferred to first
 * execution — a mistyped selector must be rejected before the Action exists, not silently at the
 * first real IP change (spec.md Clarifications). Reuses the same pure matcher the executor uses
 * at execution time (FR-008), so the two can never drift (research.md §5/§6).
 */
async function validateFirewallSelector(
  apiToken: string,
  config: UpdateFirewallRuleConfig,
): Promise<{ error: string; status: 400 | 422 } | null> {
  let rules;
  try {
    rules = await getFirewall(apiToken, config.firewallId);
  } catch {
    return { error: "firewall_not_found", status: 400 };
  }
  const matched = matchFirewallRule(rules, {
    direction: config.direction,
    protocol: config.protocol,
    port: config.port,
    description: config.description,
  });
  if ("error" in matched) {
    return matched.error === "no_match"
      ? { error: "rule_selector_no_match", status: 422 }
      : { error: "rule_selector_ambiguous", status: 422 };
  }
  return null;
}

/**
 * Best-effort, single-attempt removal of this Action's owned entries for the given families from
 * its target rule (FR-010/FR-011 on Detach, FR-017 on a family-dropping Reconfigure). Never
 * retried automatically (spec.md Clarifications) and never throws — a failure is logged, not
 * surfaced to the caller, so it can never block the Detach/Reconfigure it follows.
 */
async function cleanupFirewallEntriesBestEffort(
  deps: ActionsRouteDeps,
  accountId: string,
  actionId: string,
  state: ActionState,
  families: readonly AddressFamily[],
): Promise<void> {
  const remove: Partial<Record<AddressFamily, string>> = {};
  for (const family of families) {
    if (state.firewallOwnedEntries[family]) remove[family] = state.firewallOwnedEntries[family];
  }
  if (Object.keys(remove).length === 0) return;

  const config = state.config as UpdateFirewallRuleConfig;
  const credential = await loadOwnedActiveCredential(deps, accountId, config.providerCredentialId);
  if (!credential) {
    logger.error("Best-effort firewall cleanup skipped for action {actionId}: credential unavailable", { actionId });
    return;
  }

  try {
    await applyFirewallRuleUpdate({
      redis: deps.redis,
      config: {
        apiToken: credential.apiToken,
        accountId,
        firewallId: config.firewallId,
        direction: config.direction,
        protocol: config.protocol,
        port: config.port,
        description: config.description,
        previousEntries: {},
      },
      remove,
    });
  } catch (err) {
    logger.error("Best-effort firewall cleanup failed for action {actionId}: {error}", {
      actionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createActionsRoutes(deps: ActionsRouteDeps): Hono {
  const router = new Hono();

  router.post("/ip-clients/:ipClientId/actions", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("ipClientId");
    const body = await c.req
      .json<{
        type?: string;
        addressFamilies?: AddressFamily[];
        config?: UpdateDnsRecordConfig | UpdateFirewallRuleConfig | TraefikConfigDeliveryConfig;
      }>()
      .catch(() => ({}) as Record<string, never>);

    if (
      body.type !== HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE &&
      body.type !== HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE &&
      body.type !== TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE
    ) {
      return c.json(
        {
          error: `unsupported action type; must be "${HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE}", "${HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE}" or "${TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE}"`,
        },
        400,
      );
    }
    // A Traefik delivery action always delivers every address the device has, so the families are implied.
    const addressFamilies: AddressFamily[] | undefined =
      body.type === TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE ? ["ipv4", "ipv6"] : body.addressFamilies;
    if (!addressFamilies || addressFamilies.length === 0) {
      return c.json({ error: "addressFamilies must be a non-empty array of \"ipv4\"/\"ipv6\"" }, 400);
    }

    let actionConfig = body.config as ActionConfig | undefined;
    if (body.type === TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE) {
      const { state: device } = await loadAggregate(
        deps.eventStore,
        { accountId: auth.accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
        initialIpClientState,
        ipClientReducer,
      );
      if (!device.ipClientId || device.accountId !== auth.accountId || device.status === "decommissioned") {
        return c.json({ error: "not found" }, 404);
      }
      const validation = await validateDeliveryConfig(deps, auth.accountId, ipClientId, body.config);
      if (!validation.ok) return c.json(validation.body, validation.status);
      actionConfig = validation.config;
    } else if (body.type === HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE) {
      const config = body.config as UpdateDnsRecordConfig | undefined;
      if (!config?.providerCredentialId || !config.zone || !config.recordName) {
        return c.json({ error: "config.providerCredentialId, zone, and recordName are required" }, 400);
      }
      const credential = await loadOwnedActiveCredential(deps, auth.accountId, config.providerCredentialId);
      if (!credential) return c.json({ error: "invalid providerCredentialId" }, 400);
    } else {
      const config = body.config as UpdateFirewallRuleConfig | undefined;
      if (!config?.providerCredentialId || !config.firewallId || !config.direction || !config.protocol || !config.description) {
        return c.json(
          { error: "config.providerCredentialId, firewallId, direction, protocol, and description are required" },
          400,
        );
      }
      const credential = await loadOwnedActiveCredential(deps, auth.accountId, config.providerCredentialId);
      if (!credential) return c.json({ error: "invalid providerCredentialId" }, 400);
      const validation = await validateFirewallSelector(credential.apiToken, config);
      if (validation) return c.json({ error: validation.error }, validation.status);
    }

    const actionId = ulid();
    const data: ActionAttachedData = {
      actionId,
      accountId: auth.accountId,
      ipClientId,
      type: body.type,
      addressFamilies,
      config: actionConfig as ActionConfig,
      attachedAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.Attached, data);

    await deps.eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      accountId: auth.accountId,
      expectedSequenceNumber: 1,
      eventName: ActionEventName.Attached,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    await refreshProjection(deps, auth.accountId, actionId);
    await scheduleDelivery(deps, auth.accountId, await currentState(deps, auth.accountId, actionId));

    return c.json({ actionId }, 201);
  });

  router.get("/ip-clients/:ipClientId/actions", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("ipClientId");
    const items = await listActionsProjection(deps.redis, deps.eventStore, auth.accountId, ipClientId);
    return c.json({ items });
  });

  router.put("/actions/:id", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.accountId, actionId);
    if (!owned) return c.json({ error: "not found" }, 404);

    const body = await c.req
      .json<{
        addressFamilies?: AddressFamily[];
        config?: UpdateDnsRecordConfig | UpdateFirewallRuleConfig | TraefikConfigDeliveryConfig;
      }>()
      .catch(() => ({}) as Record<string, never>);

    if (body.addressFamilies !== undefined && body.addressFamilies.length === 0) {
      return c.json({ error: "addressFamilies, if provided, must be a non-empty array" }, 400);
    }
    let reconfiguredConfig = body.config as ActionConfig | undefined;
    if (owned.state.type === TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE) {
      if (body.config !== undefined) {
        const validation = await validateDeliveryConfig(deps, auth.accountId, owned.state.ipClientId ?? "", body.config, actionId);
        if (!validation.ok) return c.json(validation.body, validation.status);
        reconfiguredConfig = validation.config;
      }
    } else if (body.config !== undefined) {
      if (!hasProviderCredential(body.config)) return c.json({ error: "invalid providerCredentialId" }, 400);
      const credential = await loadOwnedActiveCredential(deps, auth.accountId, body.config.providerCredentialId);
      if (!credential) return c.json({ error: "invalid providerCredentialId" }, 400);

      if (owned.state.type === HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE) {
        const firewallConfig = body.config as UpdateFirewallRuleConfig;
        if (!firewallConfig.firewallId || !firewallConfig.direction || !firewallConfig.protocol || !firewallConfig.description) {
          return c.json({ error: "config.firewallId, direction, protocol, and description are required" }, 400);
        }
        const validation = await validateFirewallSelector(credential.apiToken, firewallConfig);
        if (validation) return c.json({ error: validation.error }, validation.status);
      }
    }

    const data: ActionReconfiguredData = {
      addressFamilies: owned.state.type === TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE ? undefined : body.addressFamilies,
      config: reconfiguredConfig,
      reconfiguredAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.Reconfigured, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Reconfigured,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, actionId);
    // Both the previous and the new provider need a fresh snapshot when an action moves (US2-4).
    await scheduleDelivery(deps, auth.accountId, owned.state, await currentState(deps, auth.accountId, actionId));

    // FR-017: a family dropped from an already-configured Firewall Rule Update Action gets its
    // previously-added entry removed, best-effort, using the PRE-reconfigure config/selector —
    // that's where the stale entry actually lives in Hetzner right now.
    if (owned.state.type === HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE && body.addressFamilies) {
      const droppedFamilies = owned.state.addressFamilies.filter((family) => !body.addressFamilies!.includes(family));
      await cleanupFirewallEntriesBestEffort(deps, auth.accountId, actionId, owned.state, droppedFamilies);
    }

    return c.json({ actionId });
  });

  router.post("/actions/:id/enable", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.accountId, actionId);
    if (!owned) return c.json({ error: "not found" }, 404);
    if (owned.state.status === "detached") {
      return c.json({ error: "cannot enable a detached Action" }, 409);
    }

    const data: ActionEnabledData = { actionId };
    const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.Enabled, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Enabled,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, actionId);
    await scheduleDelivery(deps, auth.accountId, owned.state);
    return c.json({ actionId, status: "enabled" });
  });

  router.post("/actions/:id/disable", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.accountId, actionId);
    if (!owned) return c.json({ error: "not found" }, 404);
    if (owned.state.status === "detached") {
      return c.json({ error: "cannot disable a detached Action" }, 409);
    }

    const data: ActionDisabledData = { actionId };
    const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.Disabled, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Disabled,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, actionId);
    await scheduleDelivery(deps, auth.accountId, owned.state);
    return c.json({ actionId, status: "disabled" });
  });

  router.delete("/actions/:id", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.accountId, actionId);
    if (!owned) return c.json({ error: "not found" }, 404);
    if (owned.state.status === "detached") {
      return c.json({ actionId, status: "detached" });
    }

    const data: ActionDetachedData = { detachedAt: new Date().toISOString() };
    const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.Detached, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Detached,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, actionId);
    await scheduleDelivery(deps, auth.accountId, owned.state);

    // FR-010/FR-011: best-effort, one-shot removal of everything this Action owns — never
    // blocks or reverts the detach itself, which has already been appended above.
    if (owned.state.type === HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE) {
      await cleanupFirewallEntriesBestEffort(deps, auth.accountId, actionId, owned.state, ["ipv4", "ipv6"]);
    }

    return c.json({ actionId, status: "detached" });
  });

  return router;
}
