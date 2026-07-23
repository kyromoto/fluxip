import { getLogger, withContext, type Logger } from "@logtape/logtape";

/**
 * The only way application code logs (contracts/logging-topology.md) — hard-codes
 * the `["fluxip","app"]` prefix so it's structurally impossible to log application
 * activity under the Access Log's category by mistake (FR-008).
 */
export function getAppLogger(category: string[]): Logger {
  return getLogger(["fluxip", "app", ...category]);
}

/**
 * Establishes the correlation id for one operation's async context (research.md §4).
 * Must be called explicitly at the start of each in-process async chain that isn't
 * a continuation of an already-established context (e.g. re-applied after a BullMQ
 * queue boundary) — LogTape's implicit context does not survive that boundary.
 */
export function withOperation<T>(correlationId: string, fn: () => T): T {
  return withContext({ correlationId }, fn);
}
