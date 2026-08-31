export interface StoredEvent<TData = unknown> {
  id: string;
  aggregateType: string;
  aggregateId: string;
  sequenceNumber: number;
  accountId: string;
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
  accountId: string;
  /** Optimistic concurrency: the sequence number this event must get; conflicts throw ConcurrencyError. */
  expectedSequenceNumber: number;
  eventName: string;
  type: string;
  source: string;
  time: string;
  data: TData;
}

export interface ReadStreamParams {
  accountId: string;
  aggregateType: string;
  aggregateId: string;
}

export interface ListAggregateIdsParams {
  accountId: string;
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
  /** Distinct aggregate IDs for an account+type — used to rebuild disposable Redis projections (research.md §9). */
  listAggregateIds(params: ListAggregateIdsParams): Promise<string[]>;
  /**
   * The one lookup that does NOT take an accountId — because finding it is the
   * point. Needed only at public, pre-auth entry points (the trigger
   * endpoint) that identify themselves by a globally unique aggregate ID
   * before any account context exists yet. Returns null if the aggregate
   * doesn't exist. Never used once an accountId is known.
   */
  resolveAccountId(aggregateType: string, aggregateId: string): Promise<string | null>;
  /** Hard-deletes every event for an account across all aggregates (research.md §12, FR-032). */
  deleteAccount(accountId: string): Promise<void>;
}
