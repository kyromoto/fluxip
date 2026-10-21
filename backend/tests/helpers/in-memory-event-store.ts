import { ConcurrencyError, type AppendEventInput, type EventStore, type StoredEvent } from "../../src/ports/event-store.js";

/** Minimal in-memory EventStore for unit tests that don't need Postgres. */
export class InMemoryEventStore implements EventStore {
  private readonly streams = new Map<string, StoredEvent[]>();

  private key(accountId: string, aggregateType: string, aggregateId: string): string {
    return `${accountId}|${aggregateType}|${aggregateId}`;
  }

  async append<TData>(input: AppendEventInput<TData>): Promise<StoredEvent<TData>> {
    const key = this.key(input.accountId, input.aggregateType, input.aggregateId);
    const stream = this.streams.get(key) ?? [];
    if (input.expectedSequenceNumber !== stream.length + 1) {
      throw new ConcurrencyError(input.aggregateType, input.aggregateId, input.expectedSequenceNumber);
    }
    const stored: StoredEvent<TData> = {
      id: input.id,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      sequenceNumber: input.expectedSequenceNumber,
      accountId: input.accountId,
      eventName: input.eventName,
      type: input.type,
      source: input.source,
      time: input.time,
      data: input.data,
    };
    this.streams.set(key, [...stream, stored as StoredEvent]);
    return stored;
  }

  async readStream<TData = unknown>(params: {
    accountId: string;
    aggregateType: string;
    aggregateId: string;
  }): Promise<StoredEvent<TData>[]> {
    return (this.streams.get(this.key(params.accountId, params.aggregateType, params.aggregateId)) ?? []) as StoredEvent<TData>[];
  }

  async listAggregateIds(params: { accountId: string; aggregateType: string }): Promise<string[]> {
    const prefix = `${params.accountId}|${params.aggregateType}|`;
    return [...this.streams.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  async resolveAccountId(aggregateType: string, aggregateId: string): Promise<string | null> {
    for (const key of this.streams.keys()) {
      const [accountId, type, id] = key.split("|");
      if (type === aggregateType && id === aggregateId) return accountId ?? null;
    }
    return null;
  }

  async deleteAccount(accountId: string): Promise<void> {
    for (const key of [...this.streams.keys()]) if (key.startsWith(`${accountId}|`)) this.streams.delete(key);
  }
}
