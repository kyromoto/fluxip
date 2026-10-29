import { ulid } from "ulid";
import type { Config } from "../../config/env.js";
import { KeyedMutex } from "../../domain/traefik-provider/keyed-mutex.js";
import {
  TraefikProviderEventName,
  type TraefikProviderSnapshotPublishFailedData,
  type TraefikProviderSnapshotPublishedData,
} from "../../domain/traefik-provider/events.js";
import type { ProviderStore } from "../../domain/traefik-provider/provider-store.js";
import {
  buildSnapshotContent,
  snapshotApproxBytes,
  snapshotContentHash,
  snapshotCounts,
  type SnapshotPayload,
} from "../../domain/traefik-provider/snapshot.js";
import { getAppLogger } from "../../observability/app-logger.js";
import type { EventStore } from "../../ports/event-store.js";

const logger = getAppLogger(["snapshot-publisher"]);

export interface PublishResult {
  snapshot: SnapshotPayload;
  /** True when this call created a new version. */
  changed: boolean;
}

export interface SnapshotPublisherDeps {
  config: Config;
  eventStore: EventStore;
  store: ProviderStore;
}

/**
 * Computes a provider's current snapshot from the event store and, when the content changed, records
 * the decision as `snapshot_published` — its sequence number is the snapshot version (research.md §3).
 */
export class SnapshotPublisher {
  private readonly mutex = new KeyedMutex();

  constructor(protected readonly deps: SnapshotPublisherDeps) {}

  /** The snapshot an agent should currently hold, or null (see {@link publish}). */
  async publishNow(accountId: string, providerId: string, causationId?: string): Promise<SnapshotPayload | null> {
    return (await this.publish(accountId, providerId, causationId))?.snapshot ?? null;
  }

  /**
   * Computes the provider's current snapshot and publishes a new version only if the content changed.
   * Returns null when the provider is gone or the state can't be published (too large). `causationId`
   * becomes the correlation id of a *new* version; `absorbedCausationIds` are the further changes that went
   * into it and are recorded on the event so the device history can tell they were delivered (specs/009).
   */
  publish(
    accountId: string,
    providerId: string,
    causationId?: string,
    absorbedCausationIds: string[] = [],
  ): Promise<PublishResult | null> {
    return this.mutex.run(providerId, async () => {
      const { store, eventStore, config } = this.deps;
      const loaded = await store.loadActive(accountId, providerId);
      if (!loaded) return null;
      const { state } = loaded;

      const content = await buildSnapshotContent(eventStore, accountId, providerId, state.name);
      const contentHash = snapshotContentHash(content);

      if (state.lastPublished && state.lastPublished.contentHash === contentHash) {
        return {
          changed: false,
          snapshot: {
            ...content,
            version: state.lastPublished.version,
            correlationId: state.lastPublished.correlationId,
            generatedAt: state.lastPublished.publishedAt,
          },
        };
      }

      const correlationId = causationId ?? ulid();
      const now = new Date().toISOString();

      const size = snapshotApproxBytes(content);
      if (size > config.agentSnapshotMaxBytes) {
        logger.error("Snapshot for provider {providerId} exceeds the size limit ({size} > {limit} bytes)", {
          accountId,
          providerId,
          size,
          limit: config.agentSnapshotMaxBytes,
          correlationId,
        });
        const failed: TraefikProviderSnapshotPublishFailedData = {
          reason: "too_large",
          correlationId,
          ...(absorbedCausationIds.length > 0 && { absorbedCausationIds }),
          failedAt: now,
        };
        await store.append(accountId, providerId, TraefikProviderEventName.SnapshotPublishFailed, failed);
        return null;
      }

      const counts = snapshotCounts(content);
      const data: TraefikProviderSnapshotPublishedData = {
        contentHash,
        ...counts,
        correlationId,
        ...(absorbedCausationIds.length > 0 && { absorbedCausationIds }),
        publishedAt: now,
      };
      const event = await store.append(accountId, providerId, TraefikProviderEventName.SnapshotPublished, data);
      logger.info("Snapshot {version} published for provider {providerId}", {
        accountId,
        providerId,
        version: event.sequenceNumber,
        correlationId,
        ...counts,
      });
      return { changed: true, snapshot: { ...content, version: event.sequenceNumber, correlationId, generatedAt: now } };
    });
  }
}
