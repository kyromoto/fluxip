import type { Redis } from "ioredis";
import { Worker, type Job } from "bullmq";
import type { Config } from "../../config/env.js";
import { actionReducer, initialActionState } from "../../domain/action/action-aggregate.js";
import {
  ACTION_AGGREGATE_TYPE,
  ActionEventName,
  HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE,
  HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE,
  type ActionFirewallRuleAppliedData,
  type UpdateDnsRecordConfig,
  type UpdateFirewallRuleConfig,
} from "../../domain/action/events.js";
import {
  actionExecutionReducer,
  initialActionExecutionState,
} from "../../domain/action-execution/action-execution-aggregate.js";
import {
  ACTION_EXECUTION_AGGREGATE_TYPE,
  ActionExecutionEventName,
  type ActionExecutionFailedData,
  type ActionExecutionNotificationSentData,
  type ActionExecutionStartedData,
  type ActionExecutionSucceededData,
  type IpValuesUsed,
  type TriggeredBy,
} from "../../domain/action-execution/events.js";
import { buildDomainEvent } from "../../domain/cloud-events.js";
import { IP_CLIENT_AGGREGATE_TYPE } from "../../domain/ip-client/events.js";
import type { HetznerFirewallResolvedConfig } from "../actions/hetzner-firewall/hetzner-firewall-executor.js";
import { toCidr } from "../actions/hetzner-firewall/hetzner-firewall-executor.js";
import { initialIpClientState, ipClientReducer } from "../../domain/ip-client/ip-client-aggregate.js";
import { NOTIFICATION_CHANNEL_AGGREGATE_TYPE } from "../../domain/notification-channel/events.js";
import {
  initialNotificationChannelState,
  notificationChannelReducer,
} from "../../domain/notification-channel/notification-channel-aggregate.js";
import { PROVIDER_CREDENTIAL_AGGREGATE_TYPE } from "../../domain/provider-credential/events.js";
import {
  initialProviderCredentialState,
  providerCredentialReducer,
} from "../../domain/provider-credential/provider-credential-aggregate.js";
import { decryptSecret } from "../../domain/provider-credential/secret-encryption.js";
import { loadAggregate } from "../../domain/replay.js";
import { getAppLogger, withOperation } from "../../observability/app-logger.js";
import type { ActionExecutor } from "../../ports/action-executor.js";
import { ConcurrencyError, type EventStore } from "../../ports/event-store.js";
import type { NotificationChannel } from "../../ports/notification-channel.js";
import { upsertExecutionProjection } from "../../projections/executions-projection.js";
import { getRedisConnection, QUEUE_NAMES } from "./queue.js";

const logger = getAppLogger(["action-execution"]);

export interface ActionExecutionJobData {
  accountId: string;
  executionId: string;
  actionId: string;
  ipClientId: string;
  causationEventId: string;
  triggeredBy: TriggeredBy;
  ipValues: IpValuesUsed;
}

export interface ActionExecutionWorkerDeps {
  config: Config;
  eventStore: EventStore;
  redis: Redis;
  executors: Record<string, ActionExecutor>;
  /** Keyed by notification_channel type (e.g. "email"); empty/absent means notifications are effectively disabled. */
  notificationChannels?: Record<string, NotificationChannel>;
}

async function nextSequence(deps: ActionExecutionWorkerDeps, accountId: string, executionId: string): Promise<number> {
  // Goes through loadAggregate (not a raw readStream) so this replay is metrics-instrumented like every other one (research.md §10).
  const { version } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: executionId },
    initialActionExecutionState,
    actionExecutionReducer,
  );
  return version + 1;
}

async function appendExecutionEvent<TData>(
  deps: ActionExecutionWorkerDeps,
  accountId: string,
  executionId: string,
  eventName: string,
  data: TData,
): Promise<void> {
  const built = buildDomainEvent(deps.config, ACTION_EXECUTION_AGGREGATE_TYPE, eventName, data);
  await deps.eventStore.append({
    id: built.id,
    aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE,
    aggregateId: executionId,
    accountId,
    expectedSequenceNumber: await nextSequence(deps, accountId, executionId),
    eventName,
    type: built.type,
    source: built.source,
    time: built.time,
    data: built.data,
  });
}

async function refreshExecutionProjection(
  deps: ActionExecutionWorkerDeps,
  accountId: string,
  executionId: string,
): Promise<void> {
  const { state } = await loadAggregate(
    deps.eventStore,
    { accountId, aggregateType: ACTION_EXECUTION_AGGREGATE_TYPE, aggregateId: executionId },
    initialActionExecutionState,
    actionExecutionReducer,
  );
  await upsertExecutionProjection(deps.redis, accountId, state);
}

/**
 * Sends a notification per the IP Client's preference (FR-030) and appends
 * `notification_sent`. Silently does nothing if notifications are off for
 * this outcome, or no active channel is configured (that's not an error —
 * data-model.md's notification_channel invariant).
 */
async function maybeSendNotification(
  deps: ActionExecutionWorkerDeps,
  accountId: string,
  ipClientId: string,
  executionId: string,
  outcome: "succeeded" | "failed",
): Promise<void> {
  try {
    const { state: ipClientState } = await loadAggregate(
      deps.eventStore,
      { accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
      initialIpClientState,
      ipClientReducer,
    );
    const preference = ipClientState.notificationPreference;
    if (preference === "off") return;
    if (preference === "failures_only" && outcome === "succeeded") return;

    const { state: channelState } = await loadAggregate(
      deps.eventStore,
      { accountId, aggregateType: NOTIFICATION_CHANNEL_AGGREGATE_TYPE, aggregateId: accountId },
      initialNotificationChannelState,
      notificationChannelReducer,
    );
    if (!channelState.channelId || channelState.status !== "active" || channelState.addresses.length === 0) return;

    const channel = deps.notificationChannels?.[channelState.type];
    if (!channel) return;

    await channel.send({
      addresses: channelState.addresses,
      subject: `FluxIP: Action execution ${outcome}`,
      body: `Execution ${executionId} for IP Client ${ipClientId} ${outcome}.`,
    });

    const data: ActionExecutionNotificationSentData = {
      channelId: channelState.channelId,
      outcomeNotified: outcome,
      sentAt: new Date().toISOString(),
    };
    await appendExecutionEvent(deps, accountId, executionId, ActionExecutionEventName.NotificationSent, data);
  } catch (err) {
    // A notification failure must never affect execution status or retry behavior.
    logger.error("Notification send failed for execution {executionId}: {error}", {
      executionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function resolveDnsExecutorConfig(
  deps: ActionExecutionWorkerDeps,
  accountId: string,
  config: UpdateDnsRecordConfig,
): Promise<{ apiToken: string; zoneName: string; recordName: string; sourceLabel: string }> {
  const { state: credentialState } = await loadAggregate(
    deps.eventStore,
    {
      accountId,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: config.providerCredentialId,
    },
    initialProviderCredentialState,
    providerCredentialReducer,
  );
  if (!credentialState.encryptedSecret || credentialState.status !== "active") {
    throw new Error("Provider Credential is missing or has been revoked");
  }
  return {
    apiToken: decryptSecret(credentialState.encryptedSecret, deps.config.credentialEncryptionKey),
    zoneName: config.zone,
    recordName: config.recordName,
    sourceLabel: deps.config.cloudEventsSource.replace(/^https?:\/\//, ""),
  };
}

async function resolveFirewallExecutorConfig(
  deps: ActionExecutionWorkerDeps,
  accountId: string,
  config: UpdateFirewallRuleConfig,
  previousEntries: { ipv4?: string; ipv6?: string },
): Promise<HetznerFirewallResolvedConfig> {
  const { state: credentialState } = await loadAggregate(
    deps.eventStore,
    {
      accountId,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: config.providerCredentialId,
    },
    initialProviderCredentialState,
    providerCredentialReducer,
  );
  if (!credentialState.encryptedSecret || credentialState.status !== "active") {
    throw new Error("Provider Credential is missing or has been revoked");
  }
  return {
    apiToken: decryptSecret(credentialState.encryptedSecret, deps.config.credentialEncryptionKey),
    accountId,
    firewallId: config.firewallId,
    direction: config.direction,
    protocol: config.protocol,
    port: config.port,
    description: config.description,
    previousEntries,
  };
}

/**
 * Records what the worker just wrote (research.md §1) on the Action's own aggregate stream.
 * Reloads immediately before appending (not reusing the job-start load, which may now be stale)
 * and retries once on a version conflict (research.md §4) — the user concurrently
 * reconfiguring/detaching/toggling the same Action in the narrow window around its own execution.
 * Never fails the execution itself: the firewall write already succeeded, which is what
 * FR-005/SC-002 measure; a persistent conflict is logged, not thrown.
 */
async function appendFirewallRuleAppliedEventBestEffort(
  deps: ActionExecutionWorkerDeps,
  accountId: string,
  actionId: string,
  ipValues: IpValuesUsed,
): Promise<void> {
  const data: ActionFirewallRuleAppliedData = {
    actionId,
    ipv4: ipValues.ipv4 ? toCidr(ipValues.ipv4, "ipv4") : undefined,
    ipv6: ipValues.ipv6 ? toCidr(ipValues.ipv6, "ipv6") : undefined,
    appliedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { version } = await loadAggregate(
        deps.eventStore,
        { accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
        initialActionState,
        actionReducer,
      );
      const built = buildDomainEvent(deps.config, ACTION_AGGREGATE_TYPE, ActionEventName.FirewallRuleApplied, data);
      await deps.eventStore.append({
        id: built.id,
        aggregateType: ACTION_AGGREGATE_TYPE,
        aggregateId: actionId,
        accountId,
        expectedSequenceNumber: version + 1,
        eventName: ActionEventName.FirewallRuleApplied,
        type: built.type,
        source: built.source,
        time: built.time,
        data: built.data,
      });
      return;
    } catch (err) {
      if (err instanceof ConcurrencyError && attempt === 0) {
        continue;
      }
      logger.error("Failed to record firewall_rule_applied for action {actionId}: {error}", {
        actionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }
}

export function createActionExecutionWorker(deps: ActionExecutionWorkerDeps): Worker<ActionExecutionJobData> {
  return new Worker<ActionExecutionJobData>(
    QUEUE_NAMES.actionExecution,
    async (job: Job<ActionExecutionJobData>) =>
      withOperation(job.data.causationEventId, async () => {
        const { accountId, executionId, actionId, ipClientId, causationEventId, triggeredBy, ipValues } = job.data;
        const attempt = job.attemptsMade + 1;

        const startedData: ActionExecutionStartedData = {
          executionId,
          accountId: accountId,
          actionId,
          ipClientId,
          triggeredBy,
          causationEventId,
          ipValuesUsed: ipValues,
          attempt,
          startedAt: new Date().toISOString(),
        };
        await appendExecutionEvent(deps, accountId, executionId, ActionExecutionEventName.Started, startedData);
        logger.info("Execution started for action {actionId}", { accountId, actionId, ipClientId, executionId, attempt });

        const { state: actionState } = await loadAggregate(
          deps.eventStore,
          { accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
          initialActionState,
          actionReducer,
        );

        if (!actionState.actionId || actionState.status !== "enabled" || !actionState.config || !actionState.type) {
          return;
        }

        const missingFamily = actionState.addressFamilies.some(
          (family) => (family === "ipv4" && !ipValues.ipv4) || (family === "ipv6" && !ipValues.ipv6),
        );
        if (missingFamily) {
          const failedData: ActionExecutionFailedData = {
            attempt,
            error: "Required address family missing from the reported IP change",
            retriesExhausted: true,
            failedAt: new Date().toISOString(),
          };
          await appendExecutionEvent(deps, accountId, executionId, ActionExecutionEventName.Failed, failedData);
          logger.error("Execution failed for action {actionId}: {error}", {
            accountId,
            actionId,
            ipClientId,
            executionId,
            error: failedData.error,
          });
          await refreshExecutionProjection(deps, accountId, executionId);
          await maybeSendNotification(deps, accountId, ipClientId, executionId, "failed");
          return;
        }

        const executor = deps.executors[actionState.type];
        if (!executor) {
          throw new Error(`No ActionExecutor registered for type "${actionState.type}"`);
        }

        try {
          const relevantIpValues: IpValuesUsed = {
            ipv4: actionState.addressFamilies.includes("ipv4") ? ipValues.ipv4 : undefined,
            ipv6: actionState.addressFamilies.includes("ipv6") ? ipValues.ipv6 : undefined,
          };

          const resolvedConfig =
            actionState.type === HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE
              ? await resolveDnsExecutorConfig(deps, accountId, actionState.config as UpdateDnsRecordConfig)
              : actionState.type === HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE
                ? await resolveFirewallExecutorConfig(
                    deps,
                    accountId,
                    actionState.config as UpdateFirewallRuleConfig,
                    actionState.firewallOwnedEntries,
                  )
                : undefined;

          const result = await executor.execute(resolvedConfig, relevantIpValues);

          const succeededData: ActionExecutionSucceededData = {
            completedAt: new Date().toISOString(),
            providerResponseSummary: result.summary,
          };
          await appendExecutionEvent(deps, accountId, executionId, ActionExecutionEventName.Succeeded, succeededData);
          logger.info("Execution succeeded for action {actionId}", { accountId, actionId, ipClientId, executionId });
          if (actionState.type === HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE) {
            await appendFirewallRuleAppliedEventBestEffort(deps, accountId, actionId, relevantIpValues);
          }
          await refreshExecutionProjection(deps, accountId, executionId);
          await maybeSendNotification(deps, accountId, ipClientId, executionId, "succeeded");
        } catch (err) {
          const maxAttempts = job.opts.attempts ?? 1;
          const isFinalAttempt = attempt >= maxAttempts;
          const failedData: ActionExecutionFailedData = {
            attempt,
            error: err instanceof Error ? err.message : String(err),
            retriesExhausted: isFinalAttempt,
            failedAt: new Date().toISOString(),
          };
          await appendExecutionEvent(deps, accountId, executionId, ActionExecutionEventName.Failed, failedData);
          logger.error("Execution failed for action {actionId}: {error}", {
            accountId,
            actionId,
            ipClientId,
            executionId,
            error: failedData.error,
          });
          await refreshExecutionProjection(deps, accountId, executionId);
          if (isFinalAttempt) {
            await maybeSendNotification(deps, accountId, ipClientId, executionId, "failed");
          }
          throw err;
        }
      }),
    { connection: getRedisConnection(deps.config) },
  );
}
