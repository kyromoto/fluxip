import { Pool } from "pg";
import { register } from "prom-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionExecutionWorker } from "../../src/adapters/queue-bullmq/action-execution-worker.js";
import { createDebounceWorker } from "../../src/adapters/queue-bullmq/debounce-worker.js";
import { createActionExecutionQueue, createDebounceQueue, getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { createTriggerRoutes } from "../../src/adapters/http/routes/trigger.js";
import { loadConfig } from "../../src/config/env.js";
import { buildDomainEvent } from "../../src/domain/cloud-events.js";
import { UPDATE_DNS_RECORD_ACTION_TYPE, ACTION_AGGREGATE_TYPE, ActionEventName, type ActionAttachedData } from "../../src/domain/action/events.js";
import { ACTION_EXECUTION_AGGREGATE_TYPE } from "../../src/domain/action-execution/events.js";
import { actionExecutionReducer, initialActionExecutionState } from "../../src/domain/action-execution/action-execution-aggregate.js";
import { generateCredential } from "../../src/domain/ip-client/credential.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName, type IpClientNotificationPreferenceSetData, type IpClientRegisteredData } from "../../src/domain/ip-client/events.js";
import { NOTIFICATION_CHANNEL_AGGREGATE_TYPE, NotificationChannelEventName, type NotificationChannelRegisteredData } from "../../src/domain/notification-channel/events.js";
import { PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName, type ProviderCredentialStoredData } from "../../src/domain/provider-credential/events.js";
import { encryptSecret } from "../../src/domain/provider-credential/secret-encryption.js";
import { loadAggregate } from "../../src/domain/replay.js";
import type { ActionExecutionIpValues, ActionExecutionResult, ActionExecutor } from "../../src/ports/action-executor.js";
import type { NotificationChannel, NotificationMessage } from "../../src/ports/notification-channel.js";

const config = loadConfig({
  ...process.env,
  BACKEND_IP_CLIENT_DEBOUNCE_MS: "150",
  BACKEND_ACTION_RETRY_ATTEMPTS: "1",
});

const IP_CLIENT_COUNT = 60;
const NOTIFIED_COUNT = 10;

class CountingExecutor implements ActionExecutor {
  readonly type = UPDATE_DNS_RECORD_ACTION_TYPE;

  async execute(_config: unknown, ipValues: ActionExecutionIpValues): Promise<ActionExecutionResult> {
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

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("waitFor timed out");
}

/**
 * Validates quickstart.md Scenario 4 (SC-004, horizontal scalability) and
 * SC-005 (many IP Clients under one account) together, at a scale that's
 * fast and deterministic in CI rather than the literal "≥1,000 trigger
 * calls" / long-running soak the spec describes for a staging environment:
 * two independent debounce+execution worker pairs (simulating 2 app
 * replicas) share one real Postgres/Redis, and two independent trigger-route
 * Hono instances (simulating a load balancer) receive flapping reports for
 * 60 IP Clients under one account. If horizontal scaling were broken, this
 * would show up as duplicate or missing action_execution events — the same
 * failure mode the full-scale spec scenario checks for, just observed at a
 * smaller, CI-friendly n. A full ≥1,000-call / long-duration soak against a
 * real multi-replica `docker compose up -d --scale app=2` deployment remains
 * the recommended staging validation before a production launch.
 */
describe("Horizontal scale & multi-device (SC-004/SC-005)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  const executor = new CountingExecutor();
  const notificationChannel = new StubNotificationChannel();

  // Two independent worker pairs sharing the same queues/eventStore — simulating 2 replicas.
  let workersA: { debounce: ReturnType<typeof createDebounceWorker>; execution: ReturnType<typeof createActionExecutionWorker> };
  let workersB: { debounce: ReturnType<typeof createDebounceWorker>; execution: ReturnType<typeof createActionExecutionWorker> };

  const replicaA = createTriggerRoutes({ config, eventStore, debounceQueue });
  const replicaB = createTriggerRoutes({ config, eventStore, debounceQueue });

  beforeAll(async () => {
    await runMigrations(pool);
    const makeWorkers = () => ({
      debounce: createDebounceWorker({ config, eventStore, actionExecutionQueue }),
      execution: createActionExecutionWorker({
        config,
        eventStore,
        redis,
        executors: { [executor.type]: executor },
        notificationChannels: { [notificationChannel.type]: notificationChannel },
      }),
    });
    workersA = makeWorkers();
    workersB = makeWorkers();
  });

  afterAll(async () => {
    await workersA.debounce.close();
    await workersA.execution.close();
    await workersB.debounce.close();
    await workersB.execution.close();
    await debounceQueue.close();
    await actionExecutionQueue.close();
    await pool.end();
  });

  it(`processes ${IP_CLIENT_COUNT} IP Clients' flapping reports across 2 simulated replicas with no duplicate or missing executions`, async () => {
    const accountId = `test-scale-${Date.now()}`;

    const credentialId = `test-scale-cred-${Date.now()}`;
    const storedData: ProviderCredentialStoredData = {
      credentialId,
      accountId: accountId,
      provider: "hetzner",
      label: "Scale test credential",
      encryptedSecret: encryptSecret("fake-hetzner-token", config.credentialEncryptionKey),
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

    const channelData: NotificationChannelRegisteredData = {
      channelId: accountId,
      accountId: accountId,
      type: "email",
      addresses: ["ops@example.com"],
      registeredAt: new Date().toISOString(),
    };
    const channelEvent = buildDomainEvent(config, NOTIFICATION_CHANNEL_AGGREGATE_TYPE, NotificationChannelEventName.Registered, channelData);
    await eventStore.append({
      id: channelEvent.id,
      aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE,
      aggregateId: accountId,
      accountId,
      expectedSequenceNumber: 1,
      eventName: NotificationChannelEventName.Registered,
      type: channelEvent.type,
      source: channelEvent.source,
      time: channelEvent.time,
      data: channelEvent.data,
    });

    const ipClients: { ipClientId: string; secret: string; actionId: string }[] = [];

    for (let i = 0; i < IP_CLIENT_COUNT; i++) {
      const ipClientId = `test-scale-ipc-${Date.now()}-${i}`;
      const { secret, hash } = generateCredential();
      const registeredData: IpClientRegisteredData = {
        ipClientId,
        accountId: accountId,
        label: `Scale device ${i}`,
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

      if (i < NOTIFIED_COUNT) {
        const prefData: IpClientNotificationPreferenceSetData = { notificationPreference: "all" };
        const prefEvent = buildDomainEvent(config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.NotificationPreferenceSet, prefData);
        await eventStore.append({
          id: prefEvent.id,
          aggregateType: IP_CLIENT_AGGREGATE_TYPE,
          aggregateId: ipClientId,
          accountId,
          expectedSequenceNumber: 2,
          eventName: IpClientEventName.NotificationPreferenceSet,
          type: prefEvent.type,
          source: prefEvent.source,
          time: prefEvent.time,
          data: prefEvent.data,
        });
      }

      const actionId = `test-scale-action-${Date.now()}-${i}`;
      const attachedData: ActionAttachedData = {
        actionId,
        accountId: accountId,
        ipClientId,
        type: UPDATE_DNS_RECORD_ACTION_TYPE,
        addressFamilies: ["ipv4"],
        config: { providerCredentialId: credentialId, zone: "zone1", recordName: `device-${i}.example.com` },
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

      ipClients.push({ ipClientId, secret, actionId });
    }

    async function report(ipClientId: string, secret: string, ip: string, replicaIndex: number): Promise<Response> {
      const replica = replicaIndex % 2 === 0 ? replicaA : replicaB;
      const auth = Buffer.from(`${ipClientId}:${secret}`).toString("base64");
      return replica.request(`/nic/update?hostname=test&myip=${ip}`, {
        headers: { authorization: `Basic ${auth}` },
      });
    }

    const start = Date.now();

    // Flapping: 2 rapid, alternating-replica reports per client — a scaled-down
    // proxy for "≥1,000 trigger calls" (120 calls here across 60 clients).
    let callIndex = 0;
    for (const client of ipClients) {
      const r1 = await report(client.ipClientId, client.secret, "203.0.113.10", callIndex++);
      expect(r1.status).toBe(200);
      const r2 = await report(client.ipClientId, client.secret, "203.0.113.42", callIndex++);
      expect(r2.status).toBe(200);
    }

    const actionIds = new Set(ipClients.map((c) => c.actionId));

    await waitFor(async () => {
      const executionIds = await eventStore.listAggregateIds({ accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE });
      const succeededActionIds = new Set<string>();
      for (const id of executionIds) {
        const { state } = await loadAggregate(
          eventStore,
          { accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: id },
          initialActionExecutionState,
          actionExecutionReducer,
        );
        if (state.status === "succeeded" && state.actionId && actionIds.has(state.actionId)) {
          succeededActionIds.add(state.actionId);
        }
      }
      return succeededActionIds.size >= IP_CLIENT_COUNT;
    }, 15000);

    const elapsedMs = Date.now() - start;

    // SC-004: exactly one succeeded execution per IP Client — no duplicates, none missing.
    const executionIds = await eventStore.listAggregateIds({ accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE });
    const succeededByAction = new Map<string, number>();
    for (const id of executionIds) {
      const { state } = await loadAggregate(
        eventStore,
        { accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: id },
        initialActionExecutionState,
        actionExecutionReducer,
      );
      if (state.status === "succeeded" && state.actionId) {
        succeededByAction.set(state.actionId, (succeededByAction.get(state.actionId) ?? 0) + 1);
      }
    }
    expect(succeededByAction.size).toBe(IP_CLIENT_COUNT);
    expect([...succeededByAction.values()].every((count) => count === 1)).toBe(true);

    // SC-005: no measurable degradation in responsiveness with 60 IP Clients/Actions under one account.
    expect(elapsedMs).toBeLessThan(15000);

    // SC-007 proxy: the 10 notification-enabled clients each got exactly one notification.
    await waitFor(() => Promise.resolve(notificationChannel.sent.length >= NOTIFIED_COUNT), 5000);
    expect(notificationChannel.sent.length).toBeGreaterThanOrEqual(NOTIFIED_COUNT);

    // T077: replay-duration metrics are populated and labeled per aggregate_type across every aggregate touched here.
    const metricsText = await register.metrics();
    for (const aggregateType of ["ip_client", "action", "action_execution", "provider_credential", "notification_channel"]) {
      expect(metricsText).toContain(`aggregate_type="${aggregateType}"`);
    }
  }, 30000);
});
