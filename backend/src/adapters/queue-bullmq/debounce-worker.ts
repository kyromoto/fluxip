import type { Queue } from "bullmq";
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { Config } from "../../config/env.js";
import { buildDomainEvent } from "../../domain/cloud-events.js";
import {
  IP_CLIENT_AGGREGATE_TYPE,
  IpClientEventName,
  type IpClientIpChangedData,
  type IpClientIpReportReceivedData,
} from "../../domain/ip-client/events.js";
import { initialIpClientState, ipClientReducer } from "../../domain/ip-client/ip-client-aggregate.js";
import { loadAggregate } from "../../domain/replay.js";
import { getAppLogger, withOperation } from "../../observability/app-logger.js";
import type { EventStore } from "../../ports/event-store.js";
import { upsertIpClientProjection } from "../../projections/ip-clients-projection.js";
import type { ActionExecutionJobData } from "./action-execution-worker.js";
import type { DebounceJobData } from "./debounce-scheduler.js";
import { fanOutActionExecutions } from "./execution-fanout-worker.js";
import { getRedisConnection, QUEUE_NAMES } from "./queue.js";

const logger = getAppLogger(["debounce"]);

export interface DebounceWorkerDeps {
  config: Config;
  eventStore: EventStore;
  redis: Redis;
  actionExecutionQueue: Queue<ActionExecutionJobData>;
}

/**
 * Runs once the 30s debounce window elapses without being superseded
 * (research.md §6). Compares the latest raw report against the last known
 * IP and, only on an actual change (FR-006), appends ip_client.ip_changed
 * and fans out Action executions (FR-010).
 */
export function createDebounceWorker(deps: DebounceWorkerDeps): Worker<DebounceJobData> {
  return new Worker<DebounceJobData>(
    QUEUE_NAMES.debounce,
    async (job: Job<DebounceJobData>) => {
      try {
        const { accountId, ipClientId } = job.data;

        const { state, events, version } = await loadAggregate(
          deps.eventStore,
          { accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId },
          initialIpClientState,
          ipClientReducer,
        );

        if (state.status !== "enabled") return;

        const lastReport = [...events].reverse().find((e) => e.eventName === IpClientEventName.IpReportReceived);
        if (!lastReport) return;
        const reportData = lastReport.data as IpClientIpReportReceivedData;

        const resolvedIPv4 = reportData.reportedIPv4 ?? state.lastKnownIPv4 ?? undefined;
        const resolvedIPv6 = reportData.reportedIPv6 ?? state.lastKnownIPv6 ?? undefined;
        const changed =
          resolvedIPv4 !== (state.lastKnownIPv4 ?? undefined) || resolvedIPv6 !== (state.lastKnownIPv6 ?? undefined);
        if (!changed) return;

        const settledAt = new Date().toISOString();
        const changedData: IpClientIpChangedData = {
          previousIPv4: state.lastKnownIPv4 ?? undefined,
          newIPv4: resolvedIPv4,
          previousIPv6: state.lastKnownIPv6 ?? undefined,
          newIPv6: resolvedIPv6,
          settledAt,
        };
        const built = buildDomainEvent(deps.config, IP_CLIENT_AGGREGATE_TYPE, IpClientEventName.IpChanged, changedData);

        await withOperation(built.id, async () => {
          const causationEvent = await deps.eventStore.append({
            id: built.id,
            aggregateType: IP_CLIENT_AGGREGATE_TYPE,
            aggregateId: ipClientId,
            accountId,
            expectedSequenceNumber: version + 1,
            eventName: IpClientEventName.IpChanged,
            type: built.type,
            source: built.source,
            time: built.time,
            data: built.data,
          });

          logger.info("IP change confirmed for {ipClientId}", {
            accountId,
            ipClientId,
            previousIPv4: changedData.previousIPv4,
            newIPv4: changedData.newIPv4,
            previousIPv6: changedData.previousIPv6,
            newIPv6: changedData.newIPv6,
          });

          const updatedState = ipClientReducer(state, causationEvent);
          await upsertIpClientProjection(deps.redis, accountId, updatedState);

          await fanOutActionExecutions(deps.eventStore, deps.actionExecutionQueue, {
            accountId,
            ipClientId,
            causationEventId: causationEvent.id,
            triggeredBy: "ip_change",
            ipValues: { ipv4: resolvedIPv4, ipv6: resolvedIPv6 },
          });
        });
      } catch (err) {
        logger.error("Error processing debounce settlement: {error}", {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    { connection: getRedisConnection(deps.config) },
  );
}
