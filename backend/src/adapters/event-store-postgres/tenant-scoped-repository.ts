import type { AppendEventInput, EventStore, StoredEvent } from "../../ports/event-store.js";

/**
 * Binds an EventStore to one tenant so every call site that holds a
 * TenantScopedRepository structurally cannot omit tenant_id (research.md §8) —
 * there is no method on this class that accepts a different tenant.
 */
export class TenantScopedRepository {
  constructor(
    private readonly eventStore: EventStore,
    private readonly tenantId: string,
  ) {}

  readStream<TData = unknown>(aggregateType: string, aggregateId: string): Promise<StoredEvent<TData>[]> {
    return this.eventStore.readStream<TData>({ tenantId: this.tenantId, aggregateType, aggregateId });
  }

  append<TData>(
    input: Omit<AppendEventInput<TData>, "tenantId">,
  ): Promise<StoredEvent<TData>> {
    return this.eventStore.append<TData>({ ...input, tenantId: this.tenantId });
  }
}
