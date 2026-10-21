import { ulid } from "ulid";
import type { Config } from "../../config/env.js";
import { ConcurrencyError, type EventStore, type StoredEvent } from "../../ports/event-store.js";
import { buildDomainEvent } from "../cloud-events.js";
import { loadAggregate } from "../replay.js";
import { KeyedMutex } from "./keyed-mutex.js";
import { TRAEFIK_PROVIDER_AGGREGATE_TYPE } from "./events.js";
import {
  initialTraefikProviderState,
  traefikProviderReducer,
  type TraefikProviderState,
} from "./traefik-provider-aggregate.js";

export interface LoadedProvider {
  state: TraefikProviderState;
  version: number;
}

/**
 * Loads and appends to `traefik_provider` streams. Appends are serialized per provider within the
 * process and retried once on a version conflict (research.md §4).
 */
export class ProviderStore {
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly eventStore: EventStore,
    private readonly config: Config,
  ) {}

  async load(accountId: string, providerId: string): Promise<LoadedProvider> {
    const { state, version } = await loadAggregate(
      this.eventStore,
      { accountId, aggregateType: TRAEFIK_PROVIDER_AGGREGATE_TYPE, aggregateId: providerId },
      initialTraefikProviderState,
      traefikProviderReducer,
    );
    return { state, version };
  }

  /** Loads only if the provider exists, belongs to the account, and is not deleted. */
  async loadActive(accountId: string, providerId: string): Promise<LoadedProvider | null> {
    const loaded = await this.load(accountId, providerId);
    if (!loaded.state.providerId || loaded.state.accountId !== accountId || loaded.state.status !== "active") return null;
    return loaded;
  }

  /** The globally unique provider id is the only pre-auth handle an agent has (research.md §8). */
  resolveAccountId(providerId: string): Promise<string | null> {
    return this.eventStore.resolveAccountId(TRAEFIK_PROVIDER_AGGREGATE_TYPE, providerId);
  }

  async listActive(accountId: string): Promise<LoadedProvider[]> {
    const ids = await this.eventStore.listAggregateIds({ accountId, aggregateType: TRAEFIK_PROVIDER_AGGREGATE_TYPE });
    const result: LoadedProvider[] = [];
    for (const id of ids) {
      const loaded = await this.load(accountId, id);
      if (loaded.state.status === "active" && loaded.state.providerId) result.push(loaded);
    }
    return result;
  }

  append<TData>(accountId: string, providerId: string, eventName: string, data: TData): Promise<StoredEvent<TData>> {
    return this.mutex.run(providerId, async () => {
      for (let attempt = 0; ; attempt++) {
        const { version } = await this.load(accountId, providerId);
        const built = buildDomainEvent(this.config, TRAEFIK_PROVIDER_AGGREGATE_TYPE, eventName, data);
        try {
          return await this.eventStore.append({
            id: built.id,
            aggregateType: TRAEFIK_PROVIDER_AGGREGATE_TYPE,
            aggregateId: providerId,
            accountId,
            expectedSequenceNumber: version + 1,
            eventName,
            type: built.type,
            source: built.source,
            time: built.time,
            data: built.data,
          });
        } catch (err) {
          if (err instanceof ConcurrencyError && attempt < 1) continue;
          throw err;
        }
      }
    });
  }

  /** A new provider id; callers append `created` as the stream's first event. */
  newProviderId(): string {
    return ulid();
  }
}
