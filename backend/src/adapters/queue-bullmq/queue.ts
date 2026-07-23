import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Config } from "../../config/env.js";

export const QUEUE_NAMES = {
  debounce: "ip-client-debounce",
  actionExecution: "action-execution",
} as const;

let sharedConnection: Redis | null = null;

/** BullMQ requires this option on any connection it manages. */
export function getRedisConnection(config: Config): Redis {
  if (!sharedConnection) {
    sharedConnection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}

export function createDebounceQueue(config: Config): Queue {
  return new Queue(QUEUE_NAMES.debounce, { connection: getRedisConnection(config) });
}

/**
 * Retry/backoff per research.md §5: bounded exponential backoff, tunable via env,
 * applied as the queue's default job options so every enqueued execution inherits it (FR-021).
 */
export function createActionExecutionQueue(config: Config): Queue {
  return new Queue(QUEUE_NAMES.actionExecution, {
    connection: getRedisConnection(config),
    defaultJobOptions: {
      attempts: config.actionRetryAttempts,
      backoff: { type: "exponential", delay: config.actionRetryBaseDelayMs },
    },
  });
}
