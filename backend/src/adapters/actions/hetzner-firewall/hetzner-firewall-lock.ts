import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

// Lua release script: only deletes the key if it still holds the token this holder set, so a
// holder can never release a lock it no longer owns (e.g. after its own TTL already expired it
// and someone else acquired it) — research.md §2 of 007-hetzner-firewall-action.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const DEFAULT_TTL_MS = 10_000;
const DEFAULT_MAX_WAIT_MS = 5_000;
const RETRY_DELAY_MS = 100;

export interface FirewallLockHandle {
  release(): Promise<void>;
}

/**
 * Advisory lock guarding the locked read-modify-write cycle any firewall rule mutation needs
 * (set_rules replaces the whole rule array in one call — research.md §2). Scoped by
 * BOTH accountId and firewallId so two different accounts' credentials can never contend on (or
 * be confused by) the same numeric Hetzner firewall ID. Only serializes FluxIP-initiated writes
 * against each other (spec.md Clarifications/Assumptions) — not a guard against a concurrent
 * manual edit in the Hetzner Console.
 */
export async function acquireFirewallLock(
  redis: Redis,
  accountId: string,
  firewallId: number,
  opts: { ttlMs?: number; maxWaitMs?: number } = {},
): Promise<FirewallLockHandle> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const key = `firewall-lock:${accountId}:${firewallId}`;
  const token = randomUUID();

  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
    if (acquired === "OK") {
      return {
        release: async () => {
          await redis.eval(RELEASE_SCRIPT, 1, key, token);
        },
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(`Could not acquire firewall lock for account ${accountId}, firewall ${firewallId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
