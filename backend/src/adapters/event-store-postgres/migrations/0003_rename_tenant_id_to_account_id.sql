-- `tenant_id` was always a 1:1 alias for the account aggregate's own ID
-- (there is no separate tenant/organization concept — see data-model.md's
-- `account` aggregate and research.md §7/§8). Renamed to `account_id` so the
-- column name matches what it actually identifies.
ALTER TABLE events RENAME COLUMN tenant_id TO account_id;
ALTER INDEX idx_events_tenant RENAME TO idx_events_account;
