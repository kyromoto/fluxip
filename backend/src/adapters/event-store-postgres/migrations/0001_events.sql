CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  sequence_number BIGINT NOT NULL,
  tenant_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  time TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (aggregate_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_events_tenant ON events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_aggregate_lookup
  ON events (tenant_id, aggregate_type, aggregate_id, sequence_number);
