import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Config } from "../../config/env.js";
import type { EventStore } from "../../ports/event-store.js";
import { buildDomainEvent } from "../cloud-events.js";
import { loadAggregate } from "../replay.js";
import { accountReducer, initialAccountState } from "./account-aggregate.js";
import { ACCOUNT_AGGREGATE_TYPE, AccountEventName, type AccountClosedData } from "./events.js";

async function purgeQueueJobsForTenant(queue: Queue<{ tenantId: string }>, tenantId: string): Promise<void> {
  const jobs = await queue.getJobs(["waiting", "delayed", "active", "paused"]);
  await Promise.all(
    jobs
      .filter((job) => job.data.tenantId === tenantId)
      .map((job) => job.remove().catch(() => undefined)),
  );
}

async function purgeProjectionKeysForTenant(redis: Redis, tenantId: string): Promise<void> {
  const pattern = `proj:${tenantId}:*`;
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = nextCursor;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
}

export interface AccountClosureServiceDeps {
  eventStore: EventStore;
  config: Config;
  redis: Redis;
  debounceQueue: Queue<{ tenantId: string }>;
  actionExecutionQueue: Queue<{ tenantId: string }>;
}

/**
 * Account closure is immediate and permanent (FR-032) — a deliberate, narrow
 * exception to event-log immutability (research.md §12, data-model.md's
 * `account` lifecycle note). No soft-delete, no grace period: once this
 * resolves, no aggregate for the tenant exists to replay.
 */
export class AccountClosureService {
  constructor(private readonly deps: AccountClosureServiceDeps) {}

  async closeAccount(tenantId: string): Promise<void> {
    const { version } = await loadAggregate(
      this.deps.eventStore,
      { tenantId, aggregateType: ACCOUNT_AGGREGATE_TYPE, aggregateId: tenantId },
      initialAccountState,
      accountReducer,
    );

    const data: AccountClosedData = { accountId: tenantId, closedAt: new Date().toISOString() };
    const built = buildDomainEvent(this.deps.config, ACCOUNT_AGGREGATE_TYPE, AccountEventName.Closed, data);
    await this.deps.eventStore.append({
      id: built.id,
      aggregateType: ACCOUNT_AGGREGATE_TYPE,
      aggregateId: tenantId,
      tenantId,
      expectedSequenceNumber: version + 1,
      eventName: AccountEventName.Closed,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    await purgeQueueJobsForTenant(this.deps.debounceQueue, tenantId);
    await purgeQueueJobsForTenant(this.deps.actionExecutionQueue, tenantId);
    await purgeProjectionKeysForTenant(this.deps.redis, tenantId);
    await this.deps.eventStore.deleteTenant(tenantId);
  }
}
