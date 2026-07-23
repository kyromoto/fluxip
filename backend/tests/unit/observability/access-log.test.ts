import { AsyncLocalStorage } from "node:async_hooks";
import { configure, reset } from "@logtape/logtape";
import { createLogRecorder, type LogRecorder } from "@logtape/testing";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccessLogMiddleware } from "../../../src/observability/access-log.js";
import { createTriggerRoutes } from "../../../src/adapters/http/routes/trigger.js";
import type { Config } from "../../../src/config/env.js";
import type { EventStore } from "../../../src/ports/event-store.js";
import type { Queue } from "bullmq";
import type { DebounceJobData } from "../../../src/adapters/queue-bullmq/debounce-scheduler.js";

function notImplemented(): never {
  throw new Error("must not be called for a request rejected before authentication");
}

// resolveTenantId resolving to null (unknown IP Client ID) is the earliest point
// a bad Trigger Device credential is rejected without ever appending an event or logging.
const stubEventStore: EventStore = {
  append: notImplemented,
  readStream: notImplemented,
  listAggregateIds: notImplemented,
  resolveTenantId: () => Promise.resolve(null),
  deleteTenant: notImplemented,
};
const stubDebounceQueue = {} as Queue<DebounceJobData>;
const stubConfig = {} as Config;

describe("Access Log middleware (User Story 2)", () => {
  let appRecorder: LogRecorder;
  let accessRecorder: LogRecorder;

  beforeEach(async () => {
    appRecorder = createLogRecorder();
    accessRecorder = createLogRecorder();
    await configure({
      reset: true,
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: { app: appRecorder.sink, access: accessRecorder.sink },
      loggers: [
        { category: ["fluxip", "app"], sinks: ["app"], lowestLevel: "debug" },
        { category: ["fluxip", "access"], sinks: ["access"], lowestLevel: "debug" },
      ],
    });
  });

  afterEach(async () => {
    await reset();
  });

  it("logs method/path/status/sourceIp and produces no Application Log entry for a request rejected before authentication", async () => {
    const app = new Hono();
    app.use("*", createAccessLogMiddleware());
    app.route("/", createTriggerRoutes({ config: stubConfig, eventStore: stubEventStore, debounceQueue: stubDebounceQueue }));

    // A syntactically valid but unknown IP Client ID — resolveTenantId returns null,
    // rejecting the request (401) without ever reaching an append or a log call.
    const res = await app.request("/nic/update?hostname=test&myip=203.0.113.10", {
      headers: { authorization: "Basic bm90LXJlYWw6YmFkLXBhc3N3b3Jk", "x-forwarded-for": "198.51.100.7" },
    });
    expect(res.status).toBe(401);

    expect(accessRecorder.records).toHaveLength(1);
    const accessRecord = accessRecorder.records[0];
    expect(accessRecord?.properties.method).toBe("GET");
    expect(accessRecord?.properties.path).toBe("/nic/update");
    expect(accessRecord?.properties.status).toBe(401);
    expect(accessRecord?.properties.sourceIp).toBe("198.51.100.7");

    // FR-007: rejected before authentication — Access Log entry exists, no Application Log entry.
    expect(appRecorder.records).toHaveLength(0);
  });
});
