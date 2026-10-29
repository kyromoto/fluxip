import type { Config } from "../../config/env.js";
import type { SnapshotScheduler } from "../../domain/traefik-provider/snapshot-scheduler.js";
import { getAppLogger, withOperation } from "../../observability/app-logger.js";
import type { PublishResult } from "../queue-bullmq/snapshot-publisher.js";
import type { SessionRegistry } from "./session-registry.js";

const logger = getAppLogger(["snapshot-coordinator"]);

export interface SnapshotPublishing {
  publish(accountId: string, providerId: string, causationId?: string, absorbedCausationIds?: string[]): Promise<PublishResult | null>;
}

interface Pending {
  accountId: string;
  /** Causes of the collapsed triggers in arrival order; the last one becomes the snapshot's correlation id. */
  causationIds: string[];
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  dirty: boolean;
}

/**
 * Turns change triggers into snapshots pushed to connected agents. Triggers for one provider that arrive
 * within the collapse window become one run (FR-022); a trigger during a run schedules exactly one more,
 * so the final state always wins (US3-4). Runs in-process, matching the single-instance design (research.md §6).
 */
export class SnapshotCoordinator implements SnapshotScheduler {
  private readonly pending = new Map<string, Pending>();
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly deps: { config: Pick<Config, "agentSnapshotCoalesceMs" | "agentResyncMs">; publisher: SnapshotPublishing; registry: SessionRegistry },
  ) {}

  async schedule(accountId: string, providerIds: string[], causationId?: string): Promise<void> {
    if (this.stopped) return;
    for (const providerId of new Set(providerIds)) {
      const entry = this.pending.get(providerId) ?? { accountId, causationIds: [], timer: null, running: false, dirty: false };
      entry.accountId = accountId;
      if (causationId) entry.causationIds.push(causationId);
      this.pending.set(providerId, entry);
      if (entry.running) {
        entry.dirty = true;
      } else if (!entry.timer) {
        entry.timer = setTimeout(() => void this.run(providerId), this.deps.config.agentSnapshotCoalesceMs);
      }
    }
  }

  private async run(providerId: string): Promise<void> {
    const entry = this.pending.get(providerId);
    if (!entry || this.stopped) return;
    entry.timer = null;
    entry.running = true;
    entry.dirty = false;
    const causationId = entry.causationIds.at(-1);
    const absorbedCausationIds = entry.causationIds.slice(0, -1);
    entry.causationIds = [];
    try {
      const work = async (): Promise<void> => {
        const result = await this.deps.publisher.publish(entry.accountId, providerId, causationId, absorbedCausationIds);
        if (result?.changed) {
          const pushed = this.deps.registry.push(providerId, { type: "snapshot", ...result.snapshot });
          logger.info("Snapshot {version} {delivery} for provider {providerId}", {
            accountId: entry.accountId,
            providerId,
            version: result.snapshot.version,
            correlationId: result.snapshot.correlationId,
            delivery: pushed ? "sent to the connected agent" : "published (no agent connected)",
          });
        }
      };
      await (causationId ? withOperation(causationId, work) : work());
    } catch (err) {
      logger.error("Snapshot run failed for provider {providerId}: {error}", {
        providerId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      entry.running = false;
      if (entry.dirty && !this.stopped) {
        entry.timer = setTimeout(() => void this.run(providerId), this.deps.config.agentSnapshotCoalesceMs);
      } else {
        this.pending.delete(providerId);
      }
    }
  }

  /** Periodic reconciliation (FR-021): resends the current state to every connected agent. */
  startResync(connectedProviders: () => { accountId: string; providerId: string }[]): void {
    if (this.resyncTimer) return;
    this.resyncTimer = setInterval(() => {
      for (const { accountId, providerId } of connectedProviders()) {
        void this.deps.publisher
          .publish(accountId, providerId)
          .then((result) => {
            if (result) this.deps.registry.push(providerId, { type: "snapshot", ...result.snapshot });
          })
          .catch((err: unknown) => {
            logger.error("Periodic resync failed for provider {providerId}: {error}", {
              providerId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
    }, this.deps.config.agentResyncMs);
    this.resyncTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    this.resyncTimer = null;
    for (const entry of this.pending.values()) if (entry.timer) clearTimeout(entry.timer);
    this.pending.clear();
  }
}
