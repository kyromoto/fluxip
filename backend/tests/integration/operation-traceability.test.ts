import { AsyncLocalStorage } from "node:async_hooks";
import { configure, reset } from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { createLogRecorder, type LogRecorder, type LogRecordMatch } from "@logtape/testing";
import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionRunRoutes } from "../../src/adapters/http/routes/action-run.js";
import { createTriggerRoutes } from "../../src/adapters/http/routes/trigger.js";
import { createActionExecutionWorker } from "../../src/adapters/queue-bullmq/action-execution-worker.js";
import { createDebounceWorker } from "../../src/adapters/queue-bullmq/debounce-worker.js";
import { createActionExecutionQueue, createDebounceQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { buildDomainEvent } from "../../src/domain/cloud-events.js";
import { createAccessLogMiddleware } from "../../src/observability/access-log.js";
import { REDACT_FIELD_PATTERNS } from "../../src/observability/logging.js";
import {
  ACTION_AGGREGATE_TYPE,
  ActionEventName,
  UPDATE_DNS_RECORD_ACTION_TYPE,
  type ActionAttachedData,
} from "../../src/domain/action/events.js";
import { generateCredential } from "../../src/domain/ip-client/credential.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName, type IpClientRegisteredData } from "../../src/domain/ip-client/events.js";
import {
  PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
  ProviderCredentialEventName,
  type ProviderCredentialStoredData,
} from "../../src/domain/provider-credential/events.js";
import { encryptSecret } from "../../src/domain/provider-credential/secret-encryption.js";
import type { ActionExecutionIpValues, ActionExecutionResult, ActionExecutor } from "../../src/ports/action-executor.js";

const config = loadConfig({
  ...process.env,
  IP_CLIENT_DEBOUNCE_MS: "200",
  ACTION_RETRY_ATTEMPTS: "1",
});

/** Fails deterministically for one zone so a single fan-out produces both a success and a failure (quickstart Scenario 1). */
class ZoneAwareExecutor implements ActionExecutor {
  readonly type = UPDATE_DNS_RECORD_ACTION_TYPE;

  async execute(resolvedConfig: unknown, ipValues: ActionExecutionIpValues): Promise<ActionExecutionResult> {
    const { zoneId } = resolvedConfig as { zoneId: string };
    if (zoneId === "zone-fail") throw new Error("simulated provider failure");
    return { summary: `stub updated with ${JSON.stringify(ipValues)}` };
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("waitFor timed out");
}

/**
 * Validates SC-001 (correlation reconstruction) and the manual-re-run
 * distinct-id clarification against the real trigger -> debounce -> fan-out
 * -> execution pipeline (this repo's existing real-Postgres+Redis pattern),
 * not the logging module in isolation.
 */
describe("Operation traceability (User Story 1)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  const executor = new ZoneAwareExecutor();

  let debounceWorker: ReturnType<typeof createDebounceWorker>;
  let actionExecutionWorker: ReturnType<typeof createActionExecutionWorker>;
  let appRecorder: LogRecorder;
  let accessRecorder: LogRecorder;

  const app = new Hono();
  // Mirrors app.ts's real mount order (FR-007): before every route, including the trigger endpoint.
  app.use("*", createAccessLogMiddleware());
  app.route("/", createTriggerRoutes({ config, eventStore, debounceQueue }));
  app.use("/actions/*", async (c, next) => {
    c.set("auth", { tenantId: c.req.header("x-test-tenant") ?? "", roles: [] });
    await next();
  });
  app.route("/", createActionRunRoutes({ eventStore, actionExecutionQueue }));

  function call(tenantId: string, path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, { ...init, headers: { ...init?.headers, "x-test-tenant": tenantId } });
  }

  function findLog(match: LogRecordMatch) {
    return appRecorder.find(match);
  }

  beforeAll(async () => {
    await runMigrations(pool);
    appRecorder = createLogRecorder();
    accessRecorder = createLogRecorder();
    // Mirrors logging.ts's real topology: two disjoint category trees, each
    // wrapped with the same redaction the production sinks use (SC-003/SC-004).
    await configure({
      reset: true,
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: {
        recorder: redactByField(appRecorder.sink, REDACT_FIELD_PATTERNS),
        access: redactByField(accessRecorder.sink, REDACT_FIELD_PATTERNS),
      },
      loggers: [
        { category: ["fluxip", "app"], sinks: ["recorder"], lowestLevel: "debug" },
        { category: ["fluxip", "access"], sinks: ["access"], lowestLevel: "debug" },
      ],
    });
    debounceWorker = createDebounceWorker({ config, eventStore, actionExecutionQueue });
    actionExecutionWorker = createActionExecutionWorker({
      config,
      eventStore,
      redis,
      executors: { [executor.type]: executor },
    });
  });

  afterAll(async () => {
    await debounceWorker.close();
    await actionExecutionWorker.close();
    await debounceQueue.close();
    await actionExecutionQueue.close();
    await pool.end();
    await reset();
  });

  it("keeps one correlation id across an entire operation, and gives a manual re-run its own", async () => {
    const tenantId = `test-trace-${Date.now()}`;
    const ipClientId = `test-trace-ipc-${Date.now()}`;
    const { secret, hash } = generateCredential();

    const registeredData: IpClientRegisteredData = {
      ipClientId,
      accountId: tenantId,
      label: "Traceability test device",
      credentialHash: hash,
      registeredAt: new Date().toISOString(),
    };
    const registeredEvent = buildDomainEvent(config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.Registered, registeredData);
    await eventStore.append({
      id: registeredEvent.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      tenantId,
      expectedSequenceNumber: 1,
      eventName: IpClientEventName.Registered,
      type: registeredEvent.type,
      source: registeredEvent.source,
      time: registeredEvent.time,
      data: registeredEvent.data,
    });

    const credentialId = `test-trace-cred-${Date.now()}`;
    const storedData: ProviderCredentialStoredData = {
      credentialId,
      accountId: tenantId,
      provider: "hetzner",
      label: "Traceability test credential",
      encryptedSecret: encryptSecret("fake-hetzner-token", config.credentialEncryptionKey),
      storedAt: new Date().toISOString(),
    };
    const storedEvent = buildDomainEvent(config, PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName.Stored, storedData);
    await eventStore.append({
      id: storedEvent.id,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: credentialId,
      tenantId,
      expectedSequenceNumber: 1,
      eventName: ProviderCredentialEventName.Stored,
      type: storedEvent.type,
      source: storedEvent.source,
      time: storedEvent.time,
      data: storedEvent.data,
    });

    async function attachAction(actionId: string, zone: string): Promise<void> {
      const attachedData: ActionAttachedData = {
        actionId,
        accountId: tenantId,
        ipClientId,
        type: UPDATE_DNS_RECORD_ACTION_TYPE,
        addressFamilies: ["ipv4"],
        config: { providerCredentialId: credentialId, zone, recordName: "home.example.com" },
        attachedAt: new Date().toISOString(),
      };
      const attachedEvent = buildDomainEvent(config, ACTION_AGGREGATE_TYPE, ActionEventName.Attached, attachedData);
      await eventStore.append({
        id: attachedEvent.id,
        aggregateType: ACTION_AGGREGATE_TYPE,
        aggregateId: actionId,
        tenantId,
        expectedSequenceNumber: 1,
        eventName: ActionEventName.Attached,
        type: attachedEvent.type,
        source: attachedEvent.source,
        time: attachedEvent.time,
        data: attachedEvent.data,
      });
    }

    const actionOkId = `test-trace-action-ok-${Date.now()}`;
    const actionFailId = `test-trace-action-fail-${Date.now()}`;
    await attachAction(actionOkId, "zone-ok");
    await attachAction(actionFailId, "zone-fail");

    // Fan out through the real HTTP trigger endpoint (exercises trigger.ts's own log call, FR-001).
    const auth = Buffer.from(`${ipClientId}:${secret}`).toString("base64");
    const triggerRes = await call(tenantId, `/nic/update?hostname=test&myip=203.0.113.10`, {
      headers: { authorization: `Basic ${auth}` },
    });
    expect(triggerRes.status).toBe(200);

    // "trigger report received" precedes any confirmed operation (research.md §3) — no correlation id.
    const reportRecord = findLog({
      rawMessage: "Trigger report received for {ipClientId}",
      properties: { ipClientId },
    });
    expect(reportRecord).toBeDefined();
    expect(reportRecord?.properties.correlationId).toBeUndefined();

    await waitFor(
      () =>
        findLog({ rawMessage: "Execution succeeded for action {actionId}", properties: { actionId: actionOkId } }) !==
        undefined,
    );
    await waitFor(
      () =>
        findLog({ rawMessage: "Execution failed for action {actionId}: {error}", properties: { actionId: actionFailId } }) !==
        undefined,
    );

    const confirmedRecord = findLog({
      rawMessage: "IP change confirmed for {ipClientId}",
      properties: { ipClientId },
    });
    const operationCorrelationId = confirmedRecord?.properties.correlationId;
    expect(typeof operationCorrelationId).toBe("string");

    // Scoped to this test's own ipClientId/actionIds — a stale job from another
    // run sharing this production-named queue must not be mistaken for this operation's records.
    const isOurAction = (props: Readonly<Record<string, unknown>>) =>
      props.actionId === actionOkId || props.actionId === actionFailId;
    const enqueuedRecords = appRecorder.filter({
      categoryPrefix: ["fluxip", "app", "execution-fanout"],
      properties: isOurAction,
    });
    const startedRecords = appRecorder.filter({
      categoryPrefix: ["fluxip", "app", "action-execution"],
      properties: isOurAction,
    });
    expect(enqueuedRecords.length).toBeGreaterThanOrEqual(2);
    expect(startedRecords.length).toBeGreaterThanOrEqual(3); // 2x started + succeeded + failed

    for (const record of [...enqueuedRecords, ...startedRecords]) {
      expect(record.properties.correlationId).toBe(operationCorrelationId);
    }

    // Manual re-run (FR-023): its own causationEventId, never the original operation's.
    const runRes = await call(tenantId, `/actions/${actionOkId}/run`, { method: "POST" });
    expect(runRes.status).toBe(202);
    const { executionId: manualExecutionId } = (await runRes.json()) as { executionId: string };

    await waitFor(
      () =>
        findLog({
          rawMessage: "Execution succeeded for action {actionId}",
          properties: { actionId: actionOkId, executionId: manualExecutionId },
        }) !== undefined,
    );

    const manualRequestedRecord = findLog({
      rawMessage: "Manual execution requested for action {actionId}",
      properties: { actionId: actionOkId, executionId: manualExecutionId },
    });
    const manualSucceededRecord = findLog({
      rawMessage: "Execution succeeded for action {actionId}",
      properties: { actionId: actionOkId, executionId: manualExecutionId },
    });
    const manualCorrelationId = manualRequestedRecord?.properties.correlationId;

    expect(typeof manualCorrelationId).toBe("string");
    expect(manualCorrelationId).not.toBe(operationCorrelationId);
    expect(manualSucceededRecord?.properties.correlationId).toBe(manualCorrelationId);

    // SC-003: this run generated simultaneous Application Log and Access Log
    // activity (the trigger HTTP request plus the manual-run HTTP request,
    // interleaved with debounce/fan-out/execution) — each stream must contain
    // only its own kind of entry, never the other's.
    expect(appRecorder.records.length).toBeGreaterThan(0);
    expect(accessRecorder.records.length).toBeGreaterThan(0);
    for (const record of appRecorder.records) {
      expect(record.category.slice(0, 2)).toEqual(["fluxip", "app"]);
    }
    for (const record of accessRecorder.records) {
      expect(record.category).toEqual(["fluxip", "access"]);
      expect(record.properties.method).toBeDefined();
      expect(record.properties.status).toBeDefined();
    }

    // SC-004: the Provider Credential's real secret value must never appear,
    // plaintext, in either stream — even though it was created and decrypted
    // for real (resolveDnsExecutorConfig) during this same run.
    const appLogText = JSON.stringify(appRecorder.records);
    const accessLogText = JSON.stringify(accessRecorder.records);
    expect(appLogText).not.toContain("fake-hetzner-token");
    expect(accessLogText).not.toContain("fake-hetzner-token");
  }, 15000);
});
