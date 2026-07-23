import { getConnInfo } from "@hono/node-server/conninfo";
import type { Queue } from "bullmq";
import { Hono } from "hono";
import type { Config } from "../../../config/env.js";
import { buildDomainEvent } from "../../../domain/cloud-events.js";
import {
  IP_CLIENT_AGGREGATE_TYPE,
  IpClientEventName,
  type IpClientIpReportReceivedData,
} from "../../../domain/ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../../../domain/ip-client/ip-client-aggregate.js";
import { verifyCredential } from "../../../domain/ip-client/credential.js";
import { loadAggregate } from "../../../domain/replay.js";
import type { EventStore } from "../../../ports/event-store.js";
import type { DebounceJobData } from "../../queue-bullmq/debounce-scheduler.js";
import { scheduleDebounce } from "../../queue-bullmq/debounce-scheduler.js";

export interface TriggerRouteDeps {
  config: Config;
  eventStore: EventStore;
  debounceQueue: Queue<DebounceJobData>;
}

function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

/**
 * Implements the dyndns2 update protocol subset (research.md §17/contracts/trigger-endpoint.md):
 * `GET /nic/update?hostname=...&myip=...&myip6=...` with HTTP Basic Auth.
 * Username = the IP Client's own ID; password = its system-generated reporting credential.
 */
export function createTriggerRoutes(deps: TriggerRouteDeps): Hono {
  const router = new Hono();

  router.get("/nic/update", async (c) => {
    const credentials = parseBasicAuth(c.req.header("authorization"));
    if (!credentials) {
      c.header("WWW-Authenticate", 'Basic realm="fluxip"');
      return c.text("badauth", 401);
    }

    const ipClientId = credentials.username;
    const tenantId = await deps.eventStore.resolveTenantId(IP_CLIENT_AGGREGATE_TYPE, ipClientId);
    if (!tenantId) {
      return c.text("badauth", 401);
    }

    const { state, version } = await loadAggregate(
      deps.eventStore,
      { tenantId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
      initialIpClientState,
      ipClientReducer,
    );

    if (!state.credentialHash || !verifyCredential(credentials.password, state.credentialHash)) {
      return c.text("badauth", 401);
    }
    if (state.status !== "enabled") {
      return c.text("badauth", 401);
    }

    let myip = c.req.query("myip");
    const myip6 = c.req.query("myip6");
    if (!myip) {
      const info = getConnInfo(c);
      myip = info.remote.address;
    }
    if (!myip && !myip6) {
      return c.text("911", 503);
    }

    const receivedAt = new Date().toISOString();
    const data: IpClientIpReportReceivedData = {
      reportedIPv4: myip,
      reportedIPv6: myip6,
      receivedAt,
    };
    const built = buildDomainEvent(deps.config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.IpReportReceived, data);

    await deps.eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      tenantId,
      expectedSequenceNumber: version + 1,
      eventName: IpClientEventName.IpReportReceived,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    await scheduleDebounce(deps.debounceQueue, deps.config, ipClientId, tenantId);

    // "good" is returned once the report is accepted for (async) processing —
    // whether it turns out to be an actual change is decided after debounce.
    return c.text(`good ${myip ?? myip6}`, 200);
  });

  return router;
}
