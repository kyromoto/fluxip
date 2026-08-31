import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Config } from "../../config/env.js";
import type { EventStore } from "../../ports/event-store.js";
import { buildDomainEvent } from "../cloud-events.js";
import { loadAggregate } from "../replay.js";
import { accountReducer, initialAccountState } from "./account-aggregate.js";
import { ACCOUNT_AGGREGATE_TYPE, AccountEventName, type AccountClosedData } from "./events.js";

async function purgeQueueJobsForAccount(queue: Queue<{ accountId: string }>, accountId: string): Promise<void> {
  const jobs = await queue.getJobs(["waiting", "delayed", "active", "paused"]);
  await Promise.all(
    jobs
      .filter((job) => job.data.accountId === accountId)
      .map((job) => job.remove().catch(() => undefined)),
  );
}

async function purgeProjectionKeysForAccount(redis: Redis, accountId: string): Promise<void> {
  const pattern = `proj:${accountId}:*`;
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
  debounceQueue: Queue<{ accountId: string }>;
  actionExecutionQueue: Queue<{ accountId: string }>;
}

/**
 * Account closure is immediate and permanent (FR-032) — a deliberate, narrow
 * exception to event-log immutability (research.md §12, data-model.md's
 * `account` lifecycle note). No soft-delete, no grace period: once this
 * resolves, no aggregate for the account exists to replay.
 */
export class AccountClosureService {
  constructor(private readonly deps: AccountClosureServiceDeps) {}

  async closeAccount(accountId: string): Promise<void> {
    const { version } = await loadAggregate(
      this.deps.eventStore,
      { accountId, aggregateType: ACCOUNT_AGGREGATE_TYPE, aggregateId: accountId },
      initialAccountState,
      accountReducer,
    );

    const data: AccountClosedData = { accountId: accountId, closedAt: new Date().toISOString() };
    const built = buildDomainEvent(this.deps.config, ACCOUNT_AGGREGATE_TYPE, AccountEventName.Closed, data);
    await this.deps.eventStore.append({
      id: built.id,
      aggregateType: ACCOUNT_AGGREGATE_TYPE,
      aggregateId: accountId,
      accountId,
      expectedSequenceNumber: version + 1,
      eventName: AccountEventName.Closed,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    await purgeQueueJobsForAccount(this.deps.debounceQueue, accountId);
    await purgeQueueJobsForAccount(this.deps.actionExecutionQueue, accountId);
    await purgeProjectionKeysForAccount(this.deps.redis, accountId);
    await this.deps.eventStore.deleteAccount(accountId);
  }
}
