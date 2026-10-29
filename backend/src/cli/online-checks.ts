import { Redis } from "ioredis";
import pg from "pg";
import { describeError } from "./describe-error.js";

export const ONLINE_CHECK_TIMEOUT_MS = 5_000;

export interface Reachability {
  service: "postgres" | "redis" | "logto";
  ok: boolean;
  /** Error code, `HTTP <status>` or `timeout`; never an address with credentials. */
  reason?: string;
}

const noop = (): void => undefined;

/** Rejects with "timeout" when the work takes longer than the limit; whatever it started is cleaned up by the caller. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export async function checkPostgres(url: string, timeoutMs = ONLINE_CHECK_TIMEOUT_MS): Promise<Reachability> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs });
  client.on("error", noop);
  try {
    await within(client.connect().then(() => client.query("SELECT 1")), timeoutMs);
    return { service: "postgres", ok: true };
  } catch (err) {
    return { service: "postgres", ok: false, reason: describeError(err) };
  } finally {
    client.end().catch(noop);
  }
}

export async function checkRedis(url: string, timeoutMs = ONLINE_CHECK_TIMEOUT_MS): Promise<Reachability> {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  // ioredis reports the real cause (ECONNREFUSED, ...) as an "error" event; connect() itself only says the connection closed.
  let cause: unknown;
  redis.on("error", (err: unknown) => {
    cause = err;
  });
  try {
    await within(redis.connect().then(() => redis.ping()), timeoutMs);
    return { service: "redis", ok: true };
  } catch (err) {
    return { service: "redis", ok: false, reason: describeError(cause ?? err) };
  } finally {
    redis.disconnect();
  }
}

/** The endpoint the backend verifies every token against (`<endpoint>/oidc/jwks`). */
export async function checkLogto(endpoint: string, timeoutMs = ONLINE_CHECK_TIMEOUT_MS): Promise<Reachability> {
  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, "")}/oidc/jwks`, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200) return { service: "logto", ok: false, reason: `HTTP ${response.status}` };
    const body = (await response.json().catch(() => null)) as { keys?: unknown } | null;
    return Array.isArray(body?.keys) ? { service: "logto", ok: true } : { service: "logto", ok: false, reason: "unexpected response" };
  } catch (err) {
    return { service: "logto", ok: false, reason: describeError(err) };
  }
}
