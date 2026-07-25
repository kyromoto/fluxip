import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionExecutionWorker } from "../../src/adapters/queue-bullmq/action-execution-worker.js";
import { createActionRunRoutes } from "../../src/adapters/http/routes/action-run.js";
import { createActionExecutionsRoutes } from "../../src/adapters/http/routes/action-executions.js";
import { createActionsRoutes } from "../../src/adapters/http/routes/actions.js";
import { createIpClientHistoryRoutes } from "../../src/adapters/http/routes/ip-client-history.js";
import { createIpClientsRoutes } from "../../src/adapters/http/routes/ip-clients.js";
import { createNotificationChannelRoutes } from "../../src/adapters/http/routes/notification-channel.js";
import { createProviderCredentialsRoutes } from "../../src/adapters/http/routes/provider-credentials.js";
import { createDebounceWorker } from "../../src/adapters/queue-bullmq/debounce-worker.js";
import { createActionExecutionQueue, createDebounceQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { scheduleDebounce } from "../../src/adapters/queue-bullmq/debounce-scheduler.js";
import { loadConfig } from "../../src/config/env.js";
import { buildDomainEvent } from "../../src/domain/cloud-events.js";
import { UPDATE_DNS_RECORD_ACTION_TYPE } from "../../src/domain/action/events.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName, type IpClientIpReportReceivedData } from "../../src/domain/ip-client/events.js";
import type { ActionExecutionIpValues, ActionExecutionResult, ActionExecutor } from "../../src/ports/action-executor.js";
import type { NotificationChannel, NotificationMessage } from "../../src/ports/notification-channel.js";

const config = loadConfig({
  ...process.env,
  BACKEND_IP_CLIENT_DEBOUNCE_MS: "200",
  BACKEND_ACTION_RETRY_ATTEMPTS: "2",
  BACKEND_ACTION_RETRY_BASE_DELAY_MS: "100",
});

class ToggleableExecutor implements ActionExecutor {
  readonly type = UPDATE_DNS_RECORD_ACTION_TYPE;
  shouldFail = true;

  async execute(_config: unknown, ipValues: ActionExecutionIpValues): Promise<ActionExecutionResult> {
    if (this.shouldFail) throw new Error("simulated provider failure");
    return { summary: `stub updated with ${JSON.stringify(ipValues)}` };
  }
}

class StubNotificationChannel implements NotificationChannel {
  readonly type = "email";
  sent: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.sent.push(message);
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("waitFor timed out");
}

/**
 * Validates quickstart.md Scenario 3 (User Story 3, SC-006/SC-007) against
 * real Postgres+Redis+BullMQ: a failing execution surfaces a diagnosable
 * error after retries are exhausted and (with preference "all") triggers a
 * notification; fixing the config and retriggering succeeds and also
 * notifies; a manual re-run creates a fresh execution using the IP Client's
 * last known IP without a new trigger call (FR-023). The email transport
 * itself is a stub capturing sent messages rather than a live SMTP relay —
 * nodemailer's wire protocol is third-party, well-tested code; what this
 * test proves is FluxIP's own notification-gating and event-sourcing logic.
 */
describe("Review, retry, and notification (User Story 3)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  const executor = new ToggleableExecutor();
  const notificationChannel = new StubNotificationChannel();

  let debounceWorker: ReturnType<typeof createDebounceWorker>;
  let actionExecutionWorker: ReturnType<typeof createActionExecutionWorker>;

  const app = new Hono();
  app.use("*", async (c, next) => {
    const tenantId = c.req.header("x-test-tenant") ?? "";
    c.set("auth", { tenantId, roles: [] });
    await accountService.ensureProvisioned(tenantId);
    await next();
  });
  app.route("/ip-clients", createIpClientsRoutes({ config, eventStore, redis, accountService }));
  app.route("/provider-credentials", createProviderCredentialsRoutes({ config, eventStore }));
  app.route("/", createActionsRoutes({ config, eventStore, redis }));
  app.route("/", createActionExecutionsRoutes({ eventStore, redis }));
  app.route("/", createActionRunRoutes({ eventStore, actionExecutionQueue }));
  app.route("/", createIpClientHistoryRoutes({ eventStore }));
  app.route("/notification-channel", createNotificationChannelRoutes({ config, eventStore }));

  function call(tenantId: string, path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, { ...init, headers: { ...init?.headers, "x-test-tenant": tenantId } });
  }

  beforeAll(async () => {
    await runMigrations(pool);
    debounceWorker = createDebounceWorker({ config, eventStore, actionExecutionQueue });
    actionExecutionWorker = createActionExecutionWorker({
      config,
      eventStore,
      redis,
      executors: { [executor.type]: executor },
      notificationChannels: { [notificationChannel.type]: notificationChannel },
    });
  });

  afterAll(async () => {
    await debounceWorker.close();
    await actionExecutionWorker.close();
    await debounceQueue.close();
    await actionExecutionQueue.close();
    await pool.end();
  });

  async function reportIp(tenantId: string, ipClientId: string, ip: string): Promise<void> {
    const reportData: IpClientIpReportReceivedData = { reportedIPv4: ip, receivedAt: new Date().toISOString() };
    const built = buildDomainEvent(config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.IpReportReceived, reportData);
    const events = await eventStore.readStream({ tenantId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId });
    await eventStore.append({
      id: built.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      tenantId,
      expectedSequenceNumber: events.length + 1,
      eventName: IpClientEventName.IpReportReceived,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });
    await scheduleDebounce(debounceQueue, config, ipClientId, tenantId);
  }

  it("surfaces a diagnosable failure, notifies on it, then succeeds and notifies again, and supports manual re-run", async () => {
    const tenantId = `test-review-${Date.now()}`;

    const credRes = await call(tenantId, "/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "hetzner", label: "cred", secret: "fake-token" }),
    });
    const { credentialId } = (await credRes.json()) as { credentialId: string };

    const ipClientRes = await call(tenantId, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "device" }),
    });
    const { ipClientId } = (await ipClientRes.json()) as { ipClientId: string };

    const attachRes = await call(tenantId, `/ip-clients/${ipClientId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "update_dns_record",
        addressFamilies: ["ipv4"],
        config: { providerCredentialId: credentialId, zone: "zone1", recordName: "home.example.com" },
      }),
    });
    const { actionId } = (await attachRes.json()) as { actionId: string };

    const channelRes = await call(tenantId, "/notification-channel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "email", addresses: ["ops@example.com"] }),
    });
    expect(channelRes.status).toBe(201);

    const prefRes = await call(tenantId, `/ip-clients/${ipClientId}/notification-preference`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preference: "all" }),
    });
    expect(prefRes.status).toBe(200);

    // 1. Failing execution — SC-006: error message sufficient to self-diagnose.
    executor.shouldFail = true;
    await reportIp(tenantId, ipClientId, "203.0.113.50");

    await waitFor(async () => {
      const res = await call(tenantId, `/actions/${actionId}/executions`);
      const { items } = (await res.json()) as { items: { status: string }[] };
      return items.some((i) => i.status === "failed");
    });

    const executionsAfterFailure = (await (await call(tenantId, `/actions/${actionId}/executions`)).json()) as {
      items: { status: string; error: string | null }[];
    };
    const failed = executionsAfterFailure.items.find((i) => i.status === "failed");
    expect(failed?.error).toContain("simulated provider failure");

    await waitFor(() => Promise.resolve(notificationChannel.sent.some((m) => m.body.includes("failed"))));
    expect(notificationChannel.sent.some((m) => m.addresses.includes("ops@example.com"))).toBe(true);

    // 2. Fix and retrigger — succeeds and notifies again (SC-007).
    const sentBeforeSuccess = notificationChannel.sent.length;
    executor.shouldFail = false;
    await reportIp(tenantId, ipClientId, "203.0.113.51");

    await waitFor(async () => {
      const res = await call(tenantId, `/actions/${actionId}/executions`);
      const { items } = (await res.json()) as { items: { status: string }[] };
      return items.some((i) => i.status === "succeeded");
    });
    await waitFor(() => Promise.resolve(notificationChannel.sent.length > sentBeforeSuccess));
    expect(notificationChannel.sent.at(-1)?.body).toContain("succeeded");

    // 3. Manual re-run (FR-023) — uses last known IP without a new trigger call.
    const executionsBeforeManual = (await (await call(tenantId, `/actions/${actionId}/executions`)).json()) as {
      items: unknown[];
    };
    const runRes = await call(tenantId, `/actions/${actionId}/run`, { method: "POST" });
    expect(runRes.status).toBe(202);

    await waitFor(async () => {
      const res = await call(tenantId, `/actions/${actionId}/executions`);
      const { items } = (await res.json()) as { items: unknown[] };
      return items.length > executionsBeforeManual.items.length;
    });
    const finalExecutions = (await (await call(tenantId, `/actions/${actionId}/executions`)).json()) as {
      items: { triggeredBy: string }[];
    };
    expect(finalExecutions.items.some((i) => i.triggeredBy === "manual")).toBe(true);

    // History feed correlates ip_changed events with their resulting executions.
    const historyRes = await call(tenantId, `/ip-clients/${ipClientId}/history`);
    const history = (await historyRes.json()) as { items: { executions: unknown[] }[] };
    expect(history.items.length).toBeGreaterThanOrEqual(2);
    expect(history.items.every((h) => h.executions.length >= 1)).toBe(true);
  }, 20000);
});
