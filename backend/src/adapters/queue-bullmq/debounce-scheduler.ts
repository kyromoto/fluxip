import type { Queue } from "bullmq";
import type { Config } from "../../config/env.js";

export interface DebounceJobData {
  ipClientId: string;
  tenantId: string;
}

/**
 * Keyed by ip_client_id alone (not the reported IP value) so a burst of
 * different IPs collapses into a single settled evaluation instead of one
 * delayed job per distinct value (research.md §6, FR-024).
 *
 * Uses BullMQ's native debounce mode (deduplication + replace + extend)
 * instead of a manual getJob/remove/add: the replace happens atomically
 * server-side, and `keepLastIfActive` covers the case where a report lands
 * while the previous settlement is already running — the latest data is
 * queued to run again (with the full debounce delay re-applied) right
 * after, instead of being silently dropped.
 */
export async function scheduleDebounce(
  queue: Queue<DebounceJobData>,
  config: Config,
  ipClientId: string,
  tenantId: string,
): Promise<void> {
  await queue.add(
    "settle",
    { ipClientId, tenantId },
    {
      delay: config.ipClientDebounceMs,
      deduplication: { id: ipClientId, extend: true, replace: true, keepLastIfActive: true },
    },
  );
}
