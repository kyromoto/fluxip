import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RedisAuthThrottle } from "../../../../src/adapters/agent-grpc/auth-throttle.js";
import { getRedisConnection } from "../../../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../../../src/config/env.js";

const config = loadConfig(process.env);

describe("RedisAuthThrottle (FR-035)", () => {
  const redis = getRedisConnection(config);
  const source = () => `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}-${Date.now()}`;
  let throttle: RedisAuthThrottle;

  beforeEach(() => {
    throttle = new RedisAuthThrottle(redis, 10, 300);
  });
  afterAll(async () => {
    await redis.quit().catch(() => undefined);
  });

  it("blocks a source after ten failures but not before", async () => {
    const attacker = source();
    for (let i = 0; i < 9; i++) await throttle.recordFailure(attacker, "p");
    expect(await throttle.isBlocked(attacker, "p")).toBe(false);
    await throttle.recordFailure(attacker, "p");
    expect(await throttle.isBlocked(attacker, "p")).toBe(true);
  });

  it("leaves other sources unaffected, so valid agents keep working", async () => {
    const attacker = source();
    const agent = source();
    for (let i = 0; i < 12; i++) await throttle.recordFailure(attacker, "p");
    expect(await throttle.isBlocked(attacker, "p")).toBe(true);
    expect(await throttle.isBlocked(agent, "p")).toBe(false);
  });

  it("counts per source, not per provider id, so guessing across providers is limited too", async () => {
    const attacker = source();
    for (let i = 0; i < 10; i++) await throttle.recordFailure(attacker, `p${i}`);
    expect(await throttle.isBlocked(attacker, "another")).toBe(true);
  });

  it("expires the block after the window", async () => {
    const attacker = source();
    const short = new RedisAuthThrottle(redis, 2, 1);
    await short.recordFailure(attacker, "p");
    await short.recordFailure(attacker, "p");
    expect(await short.isBlocked(attacker, "p")).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await short.isBlocked(attacker, "p")).toBe(false);
  });
});
