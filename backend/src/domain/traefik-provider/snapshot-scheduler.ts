/**
 * Asks for the snapshots of some providers to be recomputed soon (FR-021/FR-022). Calls for the same
 * provider within a short window collapse into one run. `causationId` ties the resulting snapshot back to
 * the triggering event (FR-061).
 */
export interface SnapshotScheduler {
  schedule(accountId: string, providerIds: string[], causationId?: string): Promise<void>;
}

export const GROUP_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
