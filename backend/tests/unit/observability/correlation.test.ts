import { AsyncLocalStorage } from "node:async_hooks";
import { configure, reset } from "@logtape/logtape";
import { createLogRecorder, type LogRecorder } from "@logtape/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAppLogger, withOperation } from "../../../src/observability/app-logger.js";

describe("withOperation/getAppLogger correlation propagation", () => {
  let recorder: LogRecorder;

  beforeEach(async () => {
    recorder = createLogRecorder();
    await configure({
      reset: true,
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: { recorder: recorder.sink },
      loggers: [{ category: ["fluxip", "app"], sinks: ["recorder"], lowestLevel: "debug" }],
    });
  });

  afterEach(async () => {
    await reset();
  });

  it("carries no correlationId outside any withOperation scope", () => {
    getAppLogger(["test"]).info("outside any operation");
    const record = recorder.find({ message: "outside any operation" });
    expect(record?.properties.correlationId).toBeUndefined();
  });

  it("propagates the same correlationId across nested synchronous and async calls", async () => {
    async function innerAsync(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      getAppLogger(["test"]).info("nested after await");
    }

    function nestedSync(): void {
      getAppLogger(["test"]).info("nested sync");
    }

    await withOperation("op-1234", async () => {
      getAppLogger(["test"]).info("top of operation");
      nestedSync();
      await innerAsync();
    });

    const topRecord = recorder.find({ message: "top of operation" });
    const syncRecord = recorder.find({ message: "nested sync" });
    const asyncRecord = recorder.find({ message: "nested after await" });

    expect(topRecord?.properties.correlationId).toBe("op-1234");
    expect(syncRecord?.properties.correlationId).toBe("op-1234");
    expect(asyncRecord?.properties.correlationId).toBe("op-1234");
  });

  it("gives a manual re-run's correlationId that differs from the original operation's", async () => {
    await withOperation("automatic-op-1", async () => {
      getAppLogger(["test"]).info("automatic operation entry");
    });
    await withOperation("manual-op-2", async () => {
      getAppLogger(["test"]).info("manual re-run entry");
    });

    const automaticRecord = recorder.find({ message: "automatic operation entry" });
    const manualRecord = recorder.find({ message: "manual re-run entry" });

    expect(automaticRecord?.properties.correlationId).toBe("automatic-op-1");
    expect(manualRecord?.properties.correlationId).toBe("manual-op-2");
    expect(automaticRecord?.properties.correlationId).not.toBe(manualRecord?.properties.correlationId);
  });

  it("scopes getAppLogger under the fluxip.app category prefix", () => {
    getAppLogger(["trigger"]).info("category check");
    const record = recorder.find({ message: "category check" });
    expect(record?.category).toEqual(["fluxip", "app", "trigger"]);
  });
});
