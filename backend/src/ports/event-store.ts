export interface StoredEvent<TData = unknown> {
  id: string;
  aggregateType: string;
  aggregateId: string;
  sequenceNumber: number;
  tenantId: string;
  eventName: string;
  type: string;
  source: string;
  time: string;
  data: TData;
}

export interface AppendEventInput<TData = unknown> {
  id: string;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  /** Optimistic concurrency: the sequence number this event must get; conflicts throw ConcurrencyError. */
  expectedSequenceNumber: number;
  eventName: string;
  type: string;
  source: string;
  time: string;
  data: TData;
}

export interface ReadStreamParams {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
}

export interface ListAggregateIdsParams {
  tenantId: string;
  aggregateType: string;
}

export class ConcurrencyError extends Error {
  constructor(aggregateType: string, aggregateId: string, expectedSequenceNumber: number) {
    super(
      `Concurrency conflict appending to ${aggregateType}/${aggregateId} at sequence ${expectedSequenceNumber}`,
    );
    this.name = "ConcurrencyError";
  }
}

/**
 * Postgres is the only implementation for now, but the domain depends on this
 * port (not the adapter directly) since research.md §2/§8 calls out the event
 * store as a seam that must stay swappable.
 */
export interface EventStore {
  append<TData>(input: AppendEventInput<TData>): Promise<StoredEvent<TData>>;
  readStream<TData = unknown>(params: ReadStreamParams): Promise<StoredEvent<TData>[]>;
  /** Distinct aggregate IDs for a tenant+type — used to rebuild disposable Redis projections (research.md §9). */
  listAggregateIds(params: ListAggregateIdsParams): Promise<string[]>;
  /**
   * The one lookup that does NOT take a tenantId — because finding it is the
   * point. Needed only at public, pre-auth entry points (the trigger
   * endpoint) that identify themselves by a globally unique aggregate ID
   * before any tenant context exists yet. Returns null if the aggregate
   * doesn't exist. Never used once a tenantId is known.
   */
  resolveTenantId(aggregateType: string, aggregateId: string): Promise<string | null>;
  /** Hard-deletes every event for a tenant across all aggregates (research.md §12, FR-032). */
  deleteTenant(tenantId: string): Promise<void>;
}
