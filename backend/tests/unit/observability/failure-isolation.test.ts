import { AsyncLocalStorage } from "node:async_hooks";
import { configure, reset, type Sink } from "@logtape/logtape";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTriggerRoutes } from "../../../src/adapters/http/routes/trigger.js";
import { getAppLogger, withOperation } from "../../../src/observability/app-logger.js";
import type { Config } from "../../../src/config/env.js";
import type { EventStore } from "../../../src/ports/event-store.js";
import type { Queue } from "bullmq";
import type { DebounceJobData } from "../../../src/adapters/queue-bullmq/debounce-scheduler.js";

const throwingSink: Sink = () => {
  throw new Error("simulated sink write failure (e.g. disk full)");
};

describe("Log sink failure isolation (User Story 3, FR-010/SC-006)", () => {
  beforeEach(async () => {
    await configure({
      reset: true,
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: { broken: throwingSink },
      loggers: [{ category: ["fluxip", "app"], sinks: ["broken"], lowestLevel: "debug" }],
    });
  });

  afterEach(async () => {
    await reset();
  });

  it("still completes the triggering HTTP request when the Application Log sink throws on every write", async () => {
    const stubEventStore: EventStore = {
      append: () => Promise.resolve({} as never),
      readStream: () => Promise.resolve([]),
      listAggregateIds: () => Promise.resolve([]),
      resolveTenantId: () => Promise.resolve("test-tenant"),
      deleteTenant: () => Promise.resolve(),
    };
    // loadAggregate replays readStream (returns []) -> initial state has no credentialHash -> badauth.
    // The point isn't the specific outcome; it's that trigger.ts's own "trigger report received"
    // log call (and its try/catch) never lets a throwing sink take down the request.
    const app = new Hono();
    app.route(
      "/",
      createTriggerRoutes({
        config: {} as Config,
        eventStore: stubEventStore,
        debounceQueue: {} as Queue<DebounceJobData>,
      }),
    );

    const auth = Buffer.from("some-ip-client:some-password").toString("base64");
    const res = await app.request("/nic/update?hostname=test&myip=203.0.113.10", {
      headers: { authorization: `Basic ${auth}` },
    });

    // 401 (badauth) here, not 500 — proves the request completed normally rather
    // than being aborted by the sink's thrown error.
    expect(res.status).toBe(401);
  });

  it("still completes business logic wrapped in withOperation()/getAppLogger() calls when the sink throws", async () => {
    const logger = getAppLogger(["action-execution"]);

    const result = await withOperation("op-failure-isolation", async () => {
      logger.info("execution started");
      const value = await Promise.resolve(42);
      logger.info("execution succeeded");
      return value;
    });

    expect(result).toBe(42);
  });
});
