import { Hono } from "hono";
import type { Config } from "../../../config/env.js";
import { buildDomainEvent } from "../../../domain/cloud-events.js";
import {
  EMAIL_NOTIFICATION_CHANNEL_TYPE,
  NOTIFICATION_CHANNEL_AGGREGATE_TYPE,
  NotificationChannelEventName,
  type NotificationChannelRegisteredData,
  type NotificationChannelReconfiguredData,
  type NotificationChannelRevokedData,
} from "../../../domain/notification-channel/events.js";
import {
  initialNotificationChannelState,
  notificationChannelReducer,
} from "../../../domain/notification-channel/notification-channel-aggregate.js";
import { loadAggregate } from "../../../domain/replay.js";
import type { EventStore } from "../../../ports/event-store.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface NotificationChannelRouteDeps {
  config: Config;
  eventStore: EventStore;
}

function isValidAddresses(addresses: unknown): addresses is string[] {
  return Array.isArray(addresses) && addresses.length > 0 && addresses.every((a) => typeof a === "string" && a.includes("@"));
}

/**
 * The contract exposes one notification channel per account (no ID in the
 * path), so — mirroring the `account` aggregate's own pattern — the
 * `notification_channel` aggregate ID is simply the tenant ID rather than a
 * generated ULID; data-model.md's 1:many relationship is a future extension
 * point this iteration doesn't need to expose yet.
 */
export function createNotificationChannelRoutes(deps: NotificationChannelRouteDeps): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const auth = getAuth(c);
    const { state } = await loadAggregate(
      deps.eventStore,
      { tenantId: auth.tenantId, aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE, aggregateId: auth.tenantId },
      initialNotificationChannelState,
      notificationChannelReducer,
    );
    if (!state.channelId || state.status !== "active") {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ type: state.type, addresses: state.addresses });
  });

  router.post("/", async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json<{ type?: string; addresses?: string[] }>().catch(() => ({}) as Record<string, never>);

    if (body.type !== EMAIL_NOTIFICATION_CHANNEL_TYPE) {
      return c.json({ error: `unsupported channel type; only "${EMAIL_NOTIFICATION_CHANNEL_TYPE}" exists in this iteration` }, 400);
    }
    if (!isValidAddresses(body.addresses)) {
      return c.json({ error: "addresses must be a non-empty array of email addresses" }, 400);
    }

    const { state, version } = await loadAggregate(
      deps.eventStore,
      { tenantId: auth.tenantId, aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE, aggregateId: auth.tenantId },
      initialNotificationChannelState,
      notificationChannelReducer,
    );
    if (state.channelId && state.status === "active") {
      return c.json({ error: "a notification channel is already registered; use PUT to reconfigure" }, 409);
    }

    const data: NotificationChannelRegisteredData = {
      channelId: auth.tenantId,
      accountId: auth.tenantId,
      type: body.type,
      addresses: body.addresses,
      registeredAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(deps.config, NOTIFICATION_CHANNEL_AGGREGATE_TYPE, NotificationChannelEventName.Registered, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE,
      aggregateId: auth.tenantId,
      tenantId: auth.tenantId,
      expectedSequenceNumber: version + 1,
      eventName: NotificationChannelEventName.Registered,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    return c.json({ type: body.type, addresses: body.addresses }, 201);
  });

  router.put("/", async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json<{ addresses?: string[] }>().catch(() => ({}) as Record<string, never>);
    if (!isValidAddresses(body.addresses)) {
      return c.json({ error: "addresses must be a non-empty array of email addresses" }, 400);
    }

    const { state, version } = await loadAggregate(
      deps.eventStore,
      { tenantId: auth.tenantId, aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE, aggregateId: auth.tenantId },
      initialNotificationChannelState,
      notificationChannelReducer,
    );
    if (!state.channelId || state.status !== "active") {
      return c.json({ error: "not found" }, 404);
    }

    const data: NotificationChannelReconfiguredData = { addresses: body.addresses, reconfiguredAt: new Date().toISOString() };
    const built = buildDomainEvent(deps.config, NOTIFICATION_CHANNEL_AGGREGATE_TYPE, NotificationChannelEventName.Reconfigured, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE,
      aggregateId: auth.tenantId,
      tenantId: auth.tenantId,
      expectedSequenceNumber: version + 1,
      eventName: NotificationChannelEventName.Reconfigured,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    return c.json({ type: state.type, addresses: body.addresses });
  });

  router.delete("/", async (c) => {
    const auth = getAuth(c);
    const { state, version } = await loadAggregate(
      deps.eventStore,
      { tenantId: auth.tenantId, aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE, aggregateId: auth.tenantId },
      initialNotificationChannelState,
      notificationChannelReducer,
    );
    if (!state.channelId || state.status !== "active") {
      return c.json({ error: "not found" }, 404);
    }

    const data: NotificationChannelRevokedData = { revokedAt: new Date().toISOString() };
    const built = buildDomainEvent(deps.config, NOTIFICATION_CHANNEL_AGGREGATE_TYPE, NotificationChannelEventName.Revoked, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE,
      aggregateId: auth.tenantId,
      tenantId: auth.tenantId,
      expectedSequenceNumber: version + 1,
      eventName: NotificationChannelEventName.Revoked,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    return c.json({ ok: true });
  });

  return router;
}
