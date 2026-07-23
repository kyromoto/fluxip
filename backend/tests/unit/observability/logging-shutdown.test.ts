import { AsyncLocalStorage } from "node:async_hooks";
import { configure, type Sink } from "@logtape/logtape";
import { describe, expect, it, vi } from "vitest";
import { disposeLogging } from "../../../src/observability/logging.js";

describe("disposeLogging (User Story 3)", () => {
  it("disposes every registered sink on graceful shutdown, so buffered Access Log writes are flushed rather than dropped (research.md §8)", async () => {
    const syncDispose = vi.fn();
    const asyncDispose = vi.fn().mockResolvedValue(undefined);

    const syncSink: Sink & Disposable = Object.assign((() => {}) as Sink, {
      [Symbol.dispose]: syncDispose,
    });
    const asyncSink: Sink & AsyncDisposable = Object.assign((() => {}) as Sink, {
      [Symbol.asyncDispose]: asyncDispose,
    });

    await configure({
      reset: true,
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: { console: syncSink, accessFile: asyncSink },
      loggers: [
        { category: ["fluxip", "app"], sinks: ["console"], lowestLevel: "debug" },
        { category: ["fluxip", "access"], sinks: ["accessFile"], lowestLevel: "debug" },
      ],
    });

    await disposeLogging();

    expect(syncDispose).toHaveBeenCalledTimes(1);
    expect(asyncDispose).toHaveBeenCalledTimes(1);
  });
});
