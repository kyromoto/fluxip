import { Hono } from "hono";
import type { Redis } from "ioredis";
import { ulid } from "ulid";
import type { Config } from "../../../config/env.js";
import { AccountService } from "../../../domain/account/account-service.js";
import { buildDomainEvent } from "../../../domain/cloud-events.js";
import { generateCredential } from "../../../domain/ip-client/credential.js";
import {
  IP_CLIENT_AGGREGATE_TYPE,
  IpClientEventName,
  type IpClientCredentialRotatedData,
  type IpClientDecommissionedData,
  type IpClientDisabledData,
  type IpClientEnabledData,
  type IpClientNotificationPreferenceSetData,
  type IpClientRegisteredData,
  type NotificationPreference,
} from "../../../domain/ip-client/events.js";
import {
  initialIpClientState,
  ipClientReducer,
  type IpClientState,
} from "../../../domain/ip-client/ip-client-aggregate.js";
import { loadAggregate } from "../../../domain/replay.js";
import type { EventStore } from "../../../ports/event-store.js";
import { listIpClientsProjection, upsertIpClientProjection } from "../../../projections/ip-clients-projection.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface IpClientsRouteDeps {
  config: Config;
  eventStore: EventStore;
  redis: Redis;
  accountService: AccountService;
}

async function countActiveIpClients(eventStore: EventStore, accountId: string): Promise<number> {
  const ids = await eventStore.listAggregateIds({ accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE });
  let count = 0;
  for (const id of ids) {
    const { state } = await loadAggregate(
      eventStore,
      { accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: id },
      initialIpClientState,
      ipClientReducer,
    );
    if (state.status !== "decommissioned") count += 1;
  }
  return count;
}

async function refreshProjection(deps: IpClientsRouteDeps, accountId: string, ipClientId: string): Promise<void> {
  const { state } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
    initialIpClientState,
    ipClientReducer,
  );
  await upsertIpClientProjection(deps.redis, accountId, state);
}

/** Loads the IP Client and returns its state+version only if owned by this account, else null (404, not 403 — FR-013/SC-003). */
async function loadOwnedIpClient(
  deps: IpClientsRouteDeps,
  accountId: string,
  ipClientId: string,
): Promise<{ state: IpClientState; version: number } | null> {
  const { state, version } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
    initialIpClientState,
    ipClientReducer,
  );
  if (!state.ipClientId || state.accountId !== accountId) return null;
  return { state, version };
}

export function createIpClientsRoutes(deps: IpClientsRouteDeps): Hono {
  const router = new Hono();

  router.post("/", async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json<{ label?: string }>().catch(() => ({}) as { label?: string });
    const label = body.label?.trim() || "Unnamed device";

    const account = await deps.accountService.getState(auth.accountId);
    const activeCount = await countActiveIpClients(deps.eventStore, auth.accountId);
    if (activeCount >= account.deviceLimit) {
      return c.json({ error: "device_limit_reached", limit: account.deviceLimit }, 409);
    }

    const ipClientId = ulid();
    const { secret, hash } = generateCredential();
    const data: IpClientRegisteredData = {
      ipClientId,
      accountId: auth.accountId,
      label,
      credentialHash: hash,
      registeredAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(deps.config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.Registered, data);

    await deps.eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId: auth.accountId,
      expectedSequenceNumber: 1,
      eventName: IpClientEventName.Registered,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    await refreshProjection(deps, auth.accountId, ipClientId);

    return c.json({ ipClientId, label, reportingCredential: { username: ipClientId, password: secret } }, 201);
  });

  router.get("/", async (c) => {
    const auth = getAuth(c);
    const items = await listIpClientsProjection(deps.redis, deps.eventStore, auth.accountId);
    return c.json({ items });
  });

  router.get("/:id", async (c) => {
    const auth = getAuth(c);
    const owned = await loadOwnedIpClient(deps, auth.accountId, c.req.param("id"));
    if (!owned) return c.json({ error: "not found" }, 404);
    const { state } = owned;
    return c.json({
      ipClientId: state.ipClientId,
      label: state.label,
      status: state.status,
      lastKnownIPv4: state.lastKnownIPv4,
      lastKnownIPv6: state.lastKnownIPv6,
      notificationPreference: state.notificationPreference,
    });
  });

  router.post("/:id/enable", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("id");
    const owned = await loadOwnedIpClient(deps, auth.accountId, ipClientId);
    if (!owned) return c.json({ error: "not found" }, 404);
    if (owned.state.status === "decommissioned") {
      return c.json({ error: "cannot enable a decommissioned IP Client" }, 409);
    }

    const data: IpClientEnabledData = { ipClientId };
    const built = buildDomainEvent(deps.config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.Enabled, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: IpClientEventName.Enabled,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, ipClientId);
    return c.json({ ipClientId, status: "enabled" });
  });

  router.post("/:id/disable", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("id");
    const owned = await loadOwnedIpClient(deps, auth.accountId, ipClientId);
    if (!owned) return c.json({ error: "not found" }, 404);
    if (owned.state.status === "decommissioned") {
      return c.json({ error: "cannot disable a decommissioned IP Client" }, 409);
    }

    const data: IpClientDisabledData = { ipClientId };
    const built = buildDomainEvent(deps.config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.Disabled, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: IpClientEventName.Disabled,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, ipClientId);
    return c.json({ ipClientId, status: "disabled" });
  });

  router.post("/:id/rotate-credential", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("id");
    const owned = await loadOwnedIpClient(deps, auth.accountId, ipClientId);
    if (!owned) return c.json({ error: "not found" }, 404);
    if (owned.state.status === "decommissioned") {
      return c.json({ error: "cannot rotate the credential of a decommissioned IP Client" }, 409);
    }

    const { secret, hash } = generateCredential();
    const data: IpClientCredentialRotatedData = { credentialHash: hash, rotatedAt: new Date().toISOString() };
    const built = buildDomainEvent(deps.config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.CredentialRotated, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: IpClientEventName.CredentialRotated,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    return c.json({ ipClientId, reportingCredential: { username: ipClientId, password: secret } });
  });

  router.put("/:id/notification-preference", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("id");
    const owned = await loadOwnedIpClient(deps, auth.accountId, ipClientId);
    if (!owned) return c.json({ error: "not found" }, 404);

    const body = await c.req.json<{ preference?: NotificationPreference }>().catch(() => ({}) as Record<string, never>);
    const valid: NotificationPreference[] = ["off", "failures_only", "all"];
    if (!body.preference || !valid.includes(body.preference)) {
      return c.json({ error: 'preference must be one of "off", "failures_only", "all"' }, 400);
    }

    const data: IpClientNotificationPreferenceSetData = { notificationPreference: body.preference };
    const built = buildDomainEvent(
      deps.config,
      IP_CLIENT_AGGREGATE_TYPE,
      IpClientEventName.NotificationPreferenceSet,
      data,
    );
    await deps.eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: IpClientEventName.NotificationPreferenceSet,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, ipClientId);
    return c.json({ ipClientId, notificationPreference: body.preference });
  });

  router.delete("/:id", async (c) => {
    const auth = getAuth(c);
    const ipClientId = c.req.param("id");
    const owned = await loadOwnedIpClient(deps, auth.accountId, ipClientId);
    if (!owned) return c.json({ error: "not found" }, 404);
    if (owned.state.status === "decommissioned") {
      return c.json({ ipClientId, status: "decommissioned" });
    }

    const data: IpClientDecommissionedData = { decommissionedAt: new Date().toISOString() };
    const built = buildDomainEvent(deps.config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.Decommissioned, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId: auth.accountId,
      expectedSequenceNumber: owned.version + 1,
      eventName: IpClientEventName.Decommissioned,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await refreshProjection(deps, auth.accountId, ipClientId);
    return c.json({ ipClientId, status: "decommissioned" });
  });

  return router;
}
