import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionExecutionWorker } from "../../src/adapters/queue-bullmq/action-execution-worker.js";
import { createDebounceWorker } from "../../src/adapters/queue-bullmq/debounce-worker.js";
import { createActionExecutionQueue, createDebounceQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { scheduleDebounce } from "../../src/adapters/queue-bullmq/debounce-scheduler.js";
import { loadConfig } from "../../src/config/env.js";
import { buildDomainEvent } from "../../src/domain/cloud-events.js";
import {
  ACTION_AGGREGATE_TYPE,
  ActionEventName,
  UPDATE_DNS_RECORD_ACTION_TYPE,
  type ActionAttachedData,
} from "../../src/domain/action/events.js";
import {
  IP_CLIENT_AGGREGATE_TYPE,
  IpClientEventName,
  type IpClientIpReportReceivedData,
  type IpClientRegisteredData,
} from "../../src/domain/ip-client/events.js";
import { generateCredential } from "../../src/domain/ip-client/credential.js";
import {
  PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
  ProviderCredentialEventName,
  type ProviderCredentialStoredData,
} from "../../src/domain/provider-credential/events.js";
import { encryptSecret } from "../../src/domain/provider-credential/secret-encryption.js";
import type { ActionExecutionIpValues, ActionExecutionResult, ActionExecutor } from "../../src/ports/action-executor.js";

const config = loadConfig({
  ...process.env,
  BACKEND_IP_CLIENT_DEBOUNCE_MS: "200",
  BACKEND_ACTION_RETRY_ATTEMPTS: "1",
});

class StubExecutor implements ActionExecutor {
  readonly type = UPDATE_DNS_RECORD_ACTION_TYPE;
  public calls: ActionExecutionIpValues[] = [];

  async execute(_config: unknown, ipValues: ActionExecutionIpValues): Promise<ActionExecutionResult> {
    this.calls.push(ipValues);
    return { summary: `stub updated with ${JSON.stringify(ipValues)}` };
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

describe("IP-change pipeline (register -> report -> debounce -> fan-out -> execute)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  const executor = new StubExecutor();

  let debounceWorker: ReturnType<typeof createDebounceWorker>;
  let actionExecutionWorker: ReturnType<typeof createActionExecutionWorker>;

  beforeAll(async () => {
    await runMigrations(pool);
    debounceWorker = createDebounceWorker({ config, eventStore, actionExecutionQueue });
    actionExecutionWorker = createActionExecutionWorker({
      config,
      eventStore,
      redis: getRedisConnection(config),
      executors: { [executor.type]: executor },
    });
  });

  afterAll(async () => {
    await debounceWorker.close();
    await actionExecutionWorker.close();
    await debounceQueue.close();
    await actionExecutionQueue.close();
    await pool.end();
  });

  it("registers an IP client, attaches an action, and executes it once on a settled IP change", async () => {
    const tenantId = `test-tenant-${Date.now()}`;
    const ipClientId = `test-ip-client-${Date.now()}`;
    const { hash } = generateCredential();

    const registeredData: IpClientRegisteredData = {
      ipClientId,
      accountId: tenantId,
      label: "Test device",
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

    const credentialId = `test-credential-${Date.now()}`;
    const storedData: ProviderCredentialStoredData = {
      credentialId,
      accountId: tenantId,
      provider: "hetzner",
      label: "Test credential",
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

    const actionId = `test-action-${Date.now()}`;
    const attachedData: ActionAttachedData = {
      actionId,
      accountId: tenantId,
      ipClientId,
      type: UPDATE_DNS_RECORD_ACTION_TYPE,
      addressFamilies: ["ipv4"],
      config: { providerCredentialId: credentialId, zone: "zone1", recordName: "home.example.com" },
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

    async function reportIp(ip: string): Promise<void> {
      const reportData: IpClientIpReportReceivedData = { reportedIPv4: ip, receivedAt: new Date().toISOString() };
      const reportEvent = buildDomainEvent(config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.IpReportReceived, reportData);
      const events = await eventStore.readStream({ tenantId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId });
      await eventStore.append({
        id: reportEvent.id,
        aggregateType: IP_CLIENT_AGGREGATE_TYPE,
        aggregateId: ipClientId,
        tenantId,
        expectedSequenceNumber: events.length + 1,
        eventName: IpClientEventName.IpReportReceived,
        type: reportEvent.type,
        source: reportEvent.source,
        time: reportEvent.time,
        data: reportEvent.data,
      });
      await scheduleDebounce(debounceQueue, config, ipClientId, tenantId);
    }

    // Flapping: two rapid reports before the debounce window elapses should settle once, on the latest value.
    await reportIp("203.0.113.10");
    await reportIp("203.0.113.42");

    await waitFor(async () => {
      const events = await eventStore.readStream({ tenantId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId });
      return events.some((e) => e.eventName === IpClientEventName.IpChanged);
    });

    const ipClientEvents = await eventStore.readStream({ tenantId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId });
    const changedEvents = ipClientEvents.filter((e) => e.eventName === IpClientEventName.IpChanged);
    expect(changedEvents).toHaveLength(1);
    expect((changedEvents[0]?.data as { newIPv4?: string }).newIPv4).toBe("203.0.113.42");

    await waitFor(() => Promise.resolve(executor.calls.length >= 1));
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]).toEqual({ ipv4: "203.0.113.42" });

    // Re-reporting the same, already-settled IP must be a no-op (FR-006) — no second execution.
    await reportIp("203.0.113.42");
    await new Promise((resolve) => setTimeout(resolve, config.ipClientDebounceMs + 300));
    expect(executor.calls).toHaveLength(1);
  }, 15000);
});
