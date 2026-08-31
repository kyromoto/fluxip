import type { AppendEventInput, EventStore, StoredEvent } from "../../ports/event-store.js";

/**
 * Binds an EventStore to one account so every call site that holds a
 * AccountScopedRepository structurally cannot omit account_id (research.md §8) —
 * there is no method on this class that accepts a different account.
 */
export class AccountScopedRepository {
  constructor(
    private readonly eventStore: EventStore,
    private readonly accountId: string,
  ) {}

  readStream<TData = unknown>(aggregateType: string, aggregateId: string): Promise<StoredEvent<TData>[]> {
    return this.eventStore.readStream<TData>({ accountId: this.accountId, aggregateType, aggregateId });
  }

  append<TData>(
    input: Omit<AppendEventInput<TData>, "accountId">,
  ): Promise<StoredEvent<TData>> {
    return this.eventStore.append<TData>({ ...input, accountId: this.accountId });
  }
}
