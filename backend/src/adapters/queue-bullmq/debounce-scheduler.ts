import type { Queue } from "bullmq";
import type { Config } from "../../config/env.js";

export interface DebounceJobData {
  ipClientId: string;
  tenantId: string;
}

function debounceJobId(ipClientId: string): string {
  // BullMQ custom job IDs cannot contain ":" (it uses colons as its own Redis key separator).
  return `debounce-${ipClientId}`;
}

/**
 * Keyed by ip_client_id alone (not the reported IP value) so a burst of
 * different IPs collapses into a single settled evaluation instead of one
 * delayed job per distinct value (research.md §6, FR-024).
 */
export async function scheduleDebounce(
  queue: Queue<DebounceJobData>,
  config: Config,
  ipClientId: string,
  tenantId: string,
): Promise<void> {
  const jobId = debounceJobId(ipClientId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    await existing.remove().catch(() => undefined);
  }
  await queue.add("settle", { ipClientId, tenantId }, { jobId, delay: config.ipClientDebounceMs });
}
