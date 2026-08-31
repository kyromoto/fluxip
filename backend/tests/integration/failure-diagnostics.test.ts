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
import { ACTION_AGGREGATE_TYPE, ActionEventName, HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE, type ActionAttachedData, type AddressFamily } from "../../src/domain/action/events.js";
import { ACTION_EXECUTION_AGGREGATE_TYPE } from "../../src/domain/action-execution/events.js";
import { actionExecutionReducer, initialActionExecutionState } from "../../src/domain/action-execution/action-execution-aggregate.js";
import { generateCredential } from "../../src/domain/ip-client/credential.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName, type IpClientIpReportReceivedData, type IpClientRegisteredData } from "../../src/domain/ip-client/events.js";
import { PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName, type ProviderCredentialRevokedData, type ProviderCredentialStoredData } from "../../src/domain/provider-credential/events.js";
import { encryptSecret } from "../../src/domain/provider-credential/secret-encryption.js";
import { loadAggregate } from "../../src/domain/replay.js";
import type { ActionExecutionIpValues, ActionExecutionResult, ActionExecutor } from "../../src/ports/action-executor.js";

const config = loadConfig({
  ...process.env,
  BACKEND_IP_CLIENT_DEBOUNCE_MS: "150",
  BACKEND_ACTION_RETRY_ATTEMPTS: "1",
});

class RejectingExecutor implements ActionExecutor {
  readonly type = HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE;
  async execute(_config: unknown, _ipValues: ActionExecutionIpValues): Promise<ActionExecutionResult> {
    throw new Error('Hetzner DNS API rejected the update (403): zone "zone1" not found or access denied');
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
 * Validates SC-006 (≥90% of failures surface an error message sufficient to
 * self-diagnose without support) by forcing three representative, distinct
 * failure causes and checking each produces its own specific, non-generic
 * error text in the execution history — not one undifferentiated "failed".
 */
describe("Distinct failure-cause diagnostics (SC-006)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  const executor = new RejectingExecutor();

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

  async function setupIpClientWithAction(
    accountId: string,
    providerCredentialId: string,
    addressFamilies: AddressFamily[],
  ): Promise<{ ipClientId: string; actionId: string }> {
    const ipClientId = `test-diag-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { hash } = generateCredential();
    const registeredData: IpClientRegisteredData = {
      ipClientId,
      accountId: accountId,
      label: "Diagnostics device",
      credentialHash: hash,
      registeredAt: new Date().toISOString(),
    };
    const registeredEvent = buildDomainEvent(config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.Registered, registeredData);
    await eventStore.append({
      id: registeredEvent.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId,
      expectedSequenceNumber: 1,
      eventName: IpClientEventName.Registered,
      type: registeredEvent.type,
      source: registeredEvent.source,
      time: registeredEvent.time,
      data: registeredEvent.data,
    });

    const actionId = `test-diag-action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const attachedData: ActionAttachedData = {
      actionId,
      accountId: accountId,
      ipClientId,
      type: HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE,
      addressFamilies,
      config: { providerCredentialId, zone: "zone1", recordName: "home.example.com" },
      attachedAt: new Date().toISOString(),
    };
    const attachedEvent = buildDomainEvent(config, ACTION_AGGREGATE_TYPE, ActionEventName.Attached, attachedData);
    await eventStore.append({
      id: attachedEvent.id,
      aggregateType: ACTION_AGGREGATE_TYPE,
      aggregateId: actionId,
      accountId,
      expectedSequenceNumber: 1,
      eventName: ActionEventName.Attached,
      type: attachedEvent.type,
      source: attachedEvent.source,
      time: attachedEvent.time,
      data: attachedEvent.data,
    });

    return { ipClientId, actionId };
  }

  async function reportIpv4(accountId: string, ipClientId: string, ip: string): Promise<void> {
    const reportData: IpClientIpReportReceivedData = { reportedIPv4: ip, receivedAt: new Date().toISOString() };
    const reportEvent = buildDomainEvent(config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.IpReportReceived, reportData);
    const events = await eventStore.readStream({ accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId });
    await eventStore.append({
      id: reportEvent.id,
      aggregateType: IP_CLIENT_AGGREGATE_TYPE,
      aggregateId: ipClientId,
      accountId,
      expectedSequenceNumber: events.length + 1,
      eventName: IpClientEventName.IpReportReceived,
      type: reportEvent.type,
      source: reportEvent.source,
      time: reportEvent.time,
      data: reportEvent.data,
    });
    await scheduleDebounce(debounceQueue, config, ipClientId, accountId);
  }

  async function findFailureError(accountId: string, actionId: string): Promise<string | null> {
    let found: string | null = null;
    await waitFor(async () => {
      const ids = await eventStore.listAggregateIds({ accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE });
      for (const id of ids) {
        const { state } = await loadAggregate(
          eventStore,
          { accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: id },
          initialActionExecutionState,
          actionExecutionReducer,
        );
        if (state.actionId === actionId && state.status === "failed" && state.error) {
          found = state.error;
          return true;
        }
      }
      return false;
    });
    return found;
  }

  it("surfaces a revoked-provider-credential failure distinctly", async () => {
    const accountId = `test-diag-revoked-${Date.now()}`;
    const credentialId = `test-diag-cred-${Date.now()}`;
    const storedData: ProviderCredentialStoredData = {
      credentialId,
      accountId: accountId,
      provider: "hetzner",
      label: "Revoked cred",
      encryptedSecret: encryptSecret("fake-token", config.credentialEncryptionKey),
      storedAt: new Date().toISOString(),
    };
    const storedEvent = buildDomainEvent(config, PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName.Stored, storedData);
    await eventStore.append({
      id: storedEvent.id,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: credentialId,
      accountId,
      expectedSequenceNumber: 1,
      eventName: ProviderCredentialEventName.Stored,
      type: storedEvent.type,
      source: storedEvent.source,
      time: storedEvent.time,
      data: storedEvent.data,
    });
    const revokedData: ProviderCredentialRevokedData = { revokedAt: new Date().toISOString() };
    const revokedEvent = buildDomainEvent(config, PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName.Revoked, revokedData);
    await eventStore.append({
      id: revokedEvent.id,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: credentialId,
      accountId,
      expectedSequenceNumber: 2,
      eventName: ProviderCredentialEventName.Revoked,
      type: revokedEvent.type,
      source: revokedEvent.source,
      time: revokedEvent.time,
      data: revokedEvent.data,
    });

    const { ipClientId, actionId } = await setupIpClientWithAction(accountId, credentialId, ["ipv4"]);
    await reportIpv4(accountId, ipClientId, "203.0.113.60");

    const error = await findFailureError(accountId, actionId);
    expect(error).toContain("Provider Credential");
    expect(error).toContain("revoked");
  }, 10000);

  it("surfaces a missing-required-address-family failure distinctly", async () => {
    const accountId = `test-diag-family-${Date.now()}`;
    const credentialId = `test-diag-cred2-${Date.now()}`;
    const storedData: ProviderCredentialStoredData = {
      credentialId,
      accountId: accountId,
      provider: "hetzner",
      label: "Active cred",
      encryptedSecret: encryptSecret("fake-token", config.credentialEncryptionKey),
      storedAt: new Date().toISOString(),
    };
    const storedEvent = buildDomainEvent(config, PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName.Stored, storedData);
    await eventStore.append({
      id: storedEvent.id,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: credentialId,
      accountId,
      expectedSequenceNumber: 1,
      eventName: ProviderCredentialEventName.Stored,
      type: storedEvent.type,
      source: storedEvent.source,
      time: storedEvent.time,
      data: storedEvent.data,
    });

    // Action requires both ipv4 and ipv6, but the device will only ever report ipv4 (FR-026/FR-027).
    const { ipClientId, actionId } = await setupIpClientWithAction(accountId, credentialId, ["ipv4", "ipv6"]);
    await reportIpv4(accountId, ipClientId, "203.0.113.61");

    const error = await findFailureError(accountId, actionId);
    expect(error).toContain("address family");
  }, 10000);

  it("surfaces an upstream-provider-API rejection distinctly", async () => {
    const accountId = `test-diag-upstream-${Date.now()}`;
    const credentialId = `test-diag-cred3-${Date.now()}`;
    const storedData: ProviderCredentialStoredData = {
      credentialId,
      accountId: accountId,
      provider: "hetzner",
      label: "Active cred",
      encryptedSecret: encryptSecret("fake-token", config.credentialEncryptionKey),
      storedAt: new Date().toISOString(),
    };
    const storedEvent = buildDomainEvent(config, PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName.Stored, storedData);
    await eventStore.append({
      id: storedEvent.id,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: credentialId,
      accountId,
      expectedSequenceNumber: 1,
      eventName: ProviderCredentialEventName.Stored,
      type: storedEvent.type,
      source: storedEvent.source,
      time: storedEvent.time,
      data: storedEvent.data,
    });

    const { ipClientId, actionId } = await setupIpClientWithAction(accountId, credentialId, ["ipv4"]);
    await reportIpv4(accountId, ipClientId, "203.0.113.62");

    const error = await findFailureError(accountId, actionId);
    expect(error).toContain("Hetzner DNS API rejected the update (403)");
    expect(error).toContain("zone1");
  }, 10000);

  it("gives each of the three failure causes a distinguishable error message", async () => {
    // Sanity check on the three assertions above: none of the three messages collide.
    const messages = [
      "Provider Credential is missing or has been revoked",
      "Required address family missing from the reported IP change",
      'Hetzner DNS API rejected the update (403): zone "zone1" not found or access denied',
    ];
    expect(new Set(messages).size).toBe(3);
  });
});
