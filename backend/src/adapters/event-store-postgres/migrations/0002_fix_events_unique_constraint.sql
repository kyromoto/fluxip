-- The original unique constraint (aggregate_id, sequence_number) omitted
-- aggregate_type, so two different aggregate types sharing the same
-- aggregate_id (e.g. `account` and `notification_channel`, both keyed by
-- tenant_id) would spuriously collide at sequence_number=1. Optimistic
-- concurrency is scoped per (aggregate_type, aggregate_id), so the
-- constraint must be too.
ALTER TABLE events DROP CONSTRAINT events_aggregate_id_sequence_number_key;
ALTER TABLE events ADD CONSTRAINT events_aggregate_type_aggregate_id_sequence_number_key
  UNIQUE (aggregate_type, aggregate_id, sequence_number);
