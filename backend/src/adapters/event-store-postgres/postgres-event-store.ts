import type { Pool } from "pg";
import {
  ConcurrencyError,
  type AppendEventInput,
  type EventStore,
  type ListAggregateIdsParams,
  type ReadStreamParams,
  type StoredEvent,
} from "../../ports/event-store.js";

interface EventRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence_number: string;
  tenant_id: string;
  event_name: string;
  type: string;
  source: string;
  time: Date;
  data: unknown;
}

function mapRow<TData>(row: EventRow): StoredEvent<TData> {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    sequenceNumber: Number(row.sequence_number),
    tenantId: row.tenant_id,
    eventName: row.event_name,
    type: row.type,
    source: row.source,
    time: row.time.toISOString(),
    data: row.data as TData,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async append<TData>(input: AppendEventInput<TData>): Promise<StoredEvent<TData>> {
    try {
      const result = await this.pool.query<EventRow>(
        `INSERT INTO events
           (id, aggregate_type, aggregate_id, sequence_number, tenant_id, event_name, type, source, time, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          input.id,
          input.aggregateType,
          input.aggregateId,
          input.expectedSequenceNumber,
          input.tenantId,
          input.eventName,
          input.type,
          input.source,
          input.time,
          JSON.stringify(input.data),
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Insert into events returned no row");
      }
      return mapRow<TData>(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConcurrencyError(input.aggregateType, input.aggregateId, input.expectedSequenceNumber);
      }
      throw err;
    }
  }

  async readStream<TData = unknown>(params: ReadStreamParams): Promise<StoredEvent<TData>[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT * FROM events
       WHERE tenant_id = $1 AND aggregate_type = $2 AND aggregate_id = $3
       ORDER BY sequence_number ASC`,
      [params.tenantId, params.aggregateType, params.aggregateId],
    );
    return result.rows.map((row) => mapRow<TData>(row));
  }

  async listAggregateIds(params: ListAggregateIdsParams): Promise<string[]> {
    const result = await this.pool.query<{ aggregate_id: string }>(
      `SELECT DISTINCT aggregate_id FROM events WHERE tenant_id = $1 AND aggregate_type = $2`,
      [params.tenantId, params.aggregateType],
    );
    return result.rows.map((row) => row.aggregate_id);
  }

  async resolveTenantId(aggregateType: string, aggregateId: string): Promise<string | null> {
    const result = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM events WHERE aggregate_type = $1 AND aggregate_id = $2 LIMIT 1`,
      [aggregateType, aggregateId],
    );
    return result.rows[0]?.tenant_id ?? null;
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.pool.query(`DELETE FROM events WHERE tenant_id = $1`, [tenantId]);
  }
}
