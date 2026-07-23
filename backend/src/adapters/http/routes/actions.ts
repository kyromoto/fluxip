import { Hono } from "hono";
import type { Redis } from "ioredis";
import { ulid } from "ulid";
import type { Config } from "../../../config/env.js";
import { actionReducer, initialActionState, type ActionState } from "../../../domain/action/action-aggregate.js";
import {
  ACTION_AGGREGATE_TYPE,
  ActionEventName,
  UPDATE_DNS_RECORD_ACTION_TYPE,
  type ActionAttachedData,
  type ActionDetachedData,
  type ActionDisabledData,
  type ActionEnabledData,
  type ActionReconfiguredData,
  type AddressFamily,
  type UpdateDnsRecordConfig,
} from "../../../domain/action/events.js";
import { buildDomainEvent } from "../../../domain/cloud-events.js";
import {
  initialProviderCredentialState,
  providerCredentialReducer,
} from "../../../domain/provider-credential/provider-credential-aggregate.js";
import { PROVIDER_CREDENTIAL_AGGREGATE_TYPE } from "../../../domain/provider-credential/events.js";
import { loadAggregate } from "../../../domain/replay.js";
import type { EventStore } from "../../../ports/event-store.js";
import { listActionsProjection, upsertActionProjection } from "../../../projections/actions-projection.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface ActionsRouteDeps {
  config: Config;
  eventStore: EventStore;
  redis: Redis;
}

async function refreshProjection(deps: ActionsRouteDeps, tenantId: string, actionId: string): Promise<void> {
  const { state } = await loadAggregate(
    deps.eventStore,
    { tenantId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
    initialActionState,
    actionReducer,
  );
  await upsertActionProjection(deps.redis, tenantId, state);
}

/** Loads the Action and returns its state+version only if owned by this tenant, else null (404 — FR-013/SC-003). */
async function loadOwnedAction(
  deps: ActionsRouteDeps,
  tenantId: string,
  actionId: string,
): Promise<{ state: ActionState; version: number } | null> {
  const { state, version } = await loadAggregate(
    deps.eventStore,
    { tenantId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
    initialActionState,
    actionReducer,
  );
  if (!state.actionId || state.accountId !== tenantId) return null;
  return { state, version };
}

export function createActionsRoutes(deps: ActionsRouteDeps): Hono {
  const router = new Hono();

  router.post("/ip-clients/:ipClientId/actions", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("ipClientId");
    const body = await c.req
      .json<{ type?: string; addressFamilies?: AddressFamily[]; config?: UpdateDnsRecordConfig }>()
      .catch(() => ({}) as Record<string, never>);

    if (body.type !== UPDATE_DNS_RECORD_ACTION_TYPE) {
      return c.json({ error: `unsupported action type; only "${UPDATE_DNS_RECORD_ACTION_TYPE}" exists in this iteration` }, 400);
    }
    if (!body.addressFamilies || body.addressFamilies.length === 0) {
      return c.json({ error: "addressFamilies must be a non-empty array of \"ipv4\"/\"ipv6\"" }, 400);
    }
    if (!body.config?.providerCredentialId || !body.config.zone || !body.config.recordName) {
      return c.json({ error: "config.providerCredentialId, zone, and recordName are required" }, 400);
    }

    const { state: credentialState } = await loadAggregate(
      deps.eventStore,
      {
        tenantId: auth.tenantId,
        aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
        aggregateId: body.config.providerCredentialId,
      },
      initialProviderCredentialState,
      providerCredentialReducer,
    );
    if (
      !credentialState.credentialId ||
      credentialState.accountId !== auth.tenantId ||
      credentialState.status !== "active"
    ) {
      return c.json({ error: "invalid providerCredentialId" }, 400);
    }

    const actionId = ulid();
    const data: ActionAttachedData = {
      actionId,
      accountId: auth.tenantId,
      ipClientId,
      type: body.type,
      addressFamilies: body.addressFamilies,
      config: body.config,
      attachedAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.Attached, data);

    await deps.eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      tenantId: auth.tenantId,
      expectedSequenceNumber: 1,
      eventName: ActionEventName.Attached,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    await refreshProjection(deps, auth.tenantId, actionId);

    return c.json({ actionId }, 201);
  });

  router.get("/ip-clients/:ipClientId/actions", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("ipClientId");
    const items = await listActionsProjection(deps.redis, deps.eventStore, auth.tenantId, ipClientId);
    return c.json({ items });
  });

  router.put("/actions/:id", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.tenantId, actionId);
    if (!owned) return c.json({ error: "not found" }, 404);

    const body = await c.req
      .json<{ addressFamilies?: AddressFamily[]; config?: UpdateDnsRecordConfig }>()
      .catch(() => ({}) as Record<string, never>);

    if (body.addressFamilies !== undefined && body.addressFamilies.length === 0) {
      return c.json({ error: "addressFamilies, if provided, must be a non-empty array" }, 400);
    }
    if (body.config !== undefined) {
      const { state: credentialState } = await loadAggregate(
        deps.eventStore,
        {
          tenantId: auth.tenantId,
          aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
          aggregateId: body.config.providerCredentialId,
        },
        initialProviderCredentialState,
        providerCredentialReducer,
      );
      if (
        !credentialState.credentialId ||
        credentialState.accountId !== auth.tenantId ||
        credentialState.status !== "active"
      ) {
        return c.json({ error: "invalid providerCredentialId" }, 400);
      }
    }

    const data: ActionReconfiguredData = {
      addressFamilies: body.addressFamilies,
      config: body.config,
      reconfiguredAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.Reconfigured, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      tenantId: auth.tenantId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Reconfigured,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.tenantId, actionId);
    return c.json({ actionId });
  });

  router.post("/actions/:id/enable", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.tenantId, actionId);
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
      tenantId: auth.tenantId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Enabled,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.tenantId, actionId);
    return c.json({ actionId, status: "enabled" });
  });

  router.post("/actions/:id/disable", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.tenantId, actionId);
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
      tenantId: auth.tenantId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Disabled,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.tenantId, actionId);
    return c.json({ actionId, status: "disabled" });
  });

  router.delete("/actions/:id", async (c) => {
    const auth = getAuth(c);
    const actionId = c.req.param("id");
    const owned = await loadOwnedAction(deps, auth.tenantId, actionId);
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
      tenantId: auth.tenantId,
      expectedSequenceNumber: owned.version + 1,
      eventName: ActionEventName.Detached,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.tenantId, actionId);
    return c.json({ actionId, status: "detached" });
  });

  return router;
}
