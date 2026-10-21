import type { Redis } from "ioredis";
import type { AuthThrottle } from "./grpc-agent-server.js";

export const THROTTLE_MAX_FAILURES = 10;
export const THROTTLE_WINDOW_SECONDS = 300;

/**
 * Brute-force guard for agent authentication (FR-035): more than {@link THROTTLE_MAX_FAILURES} failed
 * attempts from one source within {@link THROTTLE_WINDOW_SECONDS} block that source until the window ends.
 * Deliberately keyed by source only — a counter per provider id would let an attacker lock out the real agent.
 * The counter is protection, not a business decision, so Redis being the store is fine (research.md §9).
 */
export class RedisAuthThrottle implements AuthThrottle {
  constructor(
    private readonly redis: Redis,
    private readonly maxFailures = THROTTLE_MAX_FAILURES,
    private readonly windowSeconds = THROTTLE_WINDOW_SECONDS,
  ) {}

  private key(source: string): string {
    return `agentauth:fail:${source}`;
  }

  async isBlocked(source: string, _providerId: string): Promise<boolean> {
    const count = Number(await this.redis.get(this.key(source)));
    return count >= this.maxFailures;
  }

  async recordFailure(source: string, _providerId: string): Promise<void> {
    const key = this.key(source);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, this.windowSeconds);
  }
}
