import { AsyncLocalStorage } from "node:async_hooks";
import { configure, getLogger, reset } from "@logtape/logtape";
import { createLogRecorder, type LogRecorder } from "@logtape/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REDACT_FIELD_PATTERNS } from "../../../src/observability/logging.js";
import { redactByField } from "@logtape/redaction";

describe("Application Log / Access Log separation and redaction (User Story 3)", () => {
  let appRecorder: LogRecorder;
  let accessRecorder: LogRecorder;

  beforeEach(async () => {
    appRecorder = createLogRecorder();
    accessRecorder = createLogRecorder();
    // Mirrors logging.ts's real topology: two disjoint category trees, each
    // wrapped with the same redaction patterns the production sinks use.
    await configure({
      reset: true,
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: {
        app: redactByField(appRecorder.sink, REDACT_FIELD_PATTERNS),
        access: redactByField(accessRecorder.sink, REDACT_FIELD_PATTERNS),
      },
      loggers: [
        { category: ["fluxip", "app"], sinks: ["app"], lowestLevel: "debug" },
        { category: ["fluxip", "access"], sinks: ["access"], lowestLevel: "debug" },
      ],
    });
  });

  afterEach(async () => {
    await reset();
  });

  it("routes each category tree to its own sink with no overlap (FR-008)", () => {
    getLogger(["fluxip", "app", "trigger"]).info("an application log entry");
    getLogger(["fluxip", "access"]).info("an access log entry");

    expect(appRecorder.records).toHaveLength(1);
    expect(appRecorder.records[0]?.message.join("")).toBe("an application log entry");

    expect(accessRecorder.records).toHaveLength(1);
    expect(accessRecorder.records[0]?.message.join("")).toBe("an access log entry");
  });

  it("redacts a secret-shaped property from an Application Log entry", () => {
    getLogger(["fluxip", "app", "action-execution"]).info("used credential {token}", {
      token: "sk-super-secret-value",
    });

    expect(appRecorder.records).toHaveLength(1);
    const record = appRecorder.records[0];
    expect(record?.properties.token).not.toBe("sk-super-secret-value");
    expect(JSON.stringify(record)).not.toContain("sk-super-secret-value");
  });

  it("redacts a secret-shaped property from an Access Log entry", () => {
    getLogger(["fluxip", "access"]).info("request with header {authorization}", {
      authorization: "Bearer sk-super-secret-value",
    });

    expect(accessRecorder.records).toHaveLength(1);
    const record = accessRecorder.records[0];
    expect(record?.properties.authorization).not.toBe("Bearer sk-super-secret-value");
    expect(JSON.stringify(record)).not.toContain("sk-super-secret-value");
  });
});
