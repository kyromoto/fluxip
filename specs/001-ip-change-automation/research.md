# Phase 0 Research: IP-Change-Triggered Automation (FluxIP Core)

All items below were either fully specified by the user's technical-stack brief or are planning-time defaults filled in to remove ambiguity before Phase 1 design. None of the Technical Context fields in `plan.md` were left as `NEEDS CLARIFICATION`; the entries here document the *why* behind each non-obvious choice, plus the handful of concrete parameters the spec explicitly deferred to planning (retry/backoff, flapping debounce).

## 1. Runtime & language versions

- **Decision**: Node.js 22 LTS, TypeScript 5.x, strict mode.
- **Rationale**: Current Active/Maintenance LTS at time of writing; native fetch/test runner support reduces extra dependencies; matches the user-specified TypeScript/Node.js/Hono stack.
- **Alternatives considered**: Node.js 24 (newer Active LTS) — rejected only as a default because 22 has a longer track record in production; either is compatible with the rest of this plan and can be swapped with no architectural impact.

## 2. Postgres as the event store

- **Decision**: A single append-only `events` table (or one table per aggregate type — to be settled in data-model.md) storing the full CloudEvents envelope plus `aggregate_id`, `aggregate_type`, `sequence_number`, and `tenant_id` columns extracted for indexing/filtering. Writers use optimistic concurrency: insert is conditioned on `sequence_number = current_max + 1` for that aggregate, retried on conflict.
- **Rationale**: Matches the "Postgres as event store, immutable events, current state derived by projection" guardrail. Optimistic concurrency via a unique `(aggregate_id, sequence_number)` constraint is the standard, dependency-free way to prevent lost updates without distributed locks.
- **Alternatives considered**: A dedicated event-store product (EventStoreDB) — rejected, contradicts the explicit "Postgres as event store, swappable only behind a port" guardrail and adds an extra service for no v1 benefit.

## 3. CloudEvents mapping

- **Decision**: Use the `cloudevents` npm SDK to construct/validate event envelopes. `source` is read once at startup from `CLOUDEVENTS_SOURCE`; `type` is assembled as `${CLOUDEVENTS_TYPE_PREFIX}.<aggregate>.<event>` (e.g. `space.kyro.fluxip.ip_client.ip_changed`) from `CLOUDEVENTS_TYPE_PREFIX`. The event's business payload (aggregate-specific fields) lives in CloudEvents `data`; `id` is a generated ULID; `time` is set at append time.
- **Rationale**: Directly implements the user's explicit CloudEvents configuration requirement; ULIDs keep IDs sortable, which is convenient for the append-only store's natural ordering.
- **Alternatives considered**: Hand-rolled envelope struct instead of the `cloudevents` SDK — rejected, reinvents validation the SDK already provides.

## 4. Distributed, exactly-once processing (BullMQ)

- **Decision**: The trigger-ingestion endpoint appends an `ip_client.ip_report_received` event synchronously (fast, idempotent, deduplicated at the DB layer — see below) and returns immediately. A BullMQ job is enqueued with a **deterministic job ID** built from the FR-014-mandated dedup key: `sha256(ip_client_id + ':' + reported_ip_value)`. BullMQ (backed by Redis) treats adding a job with an existing ID as a no-op, giving idempotent enqueue for free; the worker that processes the job appends the resulting `ip_changed`/Action-execution events, and only ever runs one active job per ID at a time.
- **Rationale**: Directly satisfies FR-014 (exactly-once w.r.t. the device+IP dedup key) and FR-015 (no reliance on any single instance's local state) — both the dedup decision and the queue state live in shared Postgres/Redis, so any instance can enqueue or process.
- **Alternatives considered**: Application-level distributed locks (e.g., Redis `SETNX`) around a random job ID — rejected as strictly more complex than BullMQ's built-in deterministic-ID deduplication.

## 5. Retry/backoff policy for failed Action executions (resolves FR-021)

- **Decision**: BullMQ job-level retry with exponential backoff: 5 attempts, base delay 30s, doubling (30s, 60s, 120s, 240s, 480s ≈ 15 minutes total), after which the execution is recorded as a final failure (`action_execution.failed` with `retriesExhausted: true`). Values are read from env (`ACTION_RETRY_ATTEMPTS`, `ACTION_RETRY_BASE_DELAY_MS`) so they can be tuned per deployment without a code change.
- **Rationale**: Bounded, predictable, and fits within SC-002's 5-minute DNS-update target for the common case (first attempt succeeds) while still giving transient third-party outages (Hetzner API blips) a reasonable chance to resolve before the user is shown a failure.
- **Alternatives considered**: Unbounded retry — explicitly rejected by the edge case "must not be silently retried forever."

## 6. IP-flapping debounce (resolves FR-024)

- **Decision**: A per-IP-Client debounce window of 30 seconds (env: `IP_CLIENT_DEBOUNCE_MS`), implemented as a BullMQ **delayed** job keyed by a deterministic ID derived from `ip_client_id` alone (not the IP value). Each new `ip_report_received` event removes/re-adds that delayed job with a fresh 30s delay; when the delay finally elapses without being superseded, the worker reads the client's latest reported IP (via replay, not the Redis projection — see §8) and, only then, appends `ip_client.ip_changed` and proceeds to Action execution.
- **Rationale**: "As promptly as possible, but not once per flap" is satisfied by a short, fixed settle window; keying the debounce job by client (not client+IP) ensures a burst of different IPs collapses into a single settled evaluation instead of one delayed job per distinct value.
- **Alternatives considered**: No debounce, rely solely on the FR-014 dedup key — rejected, since dedup only prevents re-processing the *same* IP twice; it does nothing for a device alternating between two IPs (A→B→A→B), which would still fire an Action per flap.

## 7. Authentication (Logto / OIDC)

- **Decision**: Hono middleware verifies incoming OIDC access tokens against Logto's JWKS endpoint using `jose`, with JWKS response caching. The token's subject claim is taken as the `tenant_id` used to tag every event the request causes. Logto owns registration/login/password reset entirely; FluxIP never sees or stores a password.
- **Rationale**: Matches the explicit requirement that Logto is the sole identity provider and that FluxIP's own isolation logic (tenant_id on every event) is independent of how the user authenticated.
- **Alternatives considered**: Session cookies issued by FluxIP itself — rejected, contradicts "FluxIP verwaltet keine Passwörter selbst."

## 8. Tenant isolation enforcement

- **Decision**: Every read/write repository method operating on the event store or a projection requires a `tenant_id` parameter and enforces it in the SQL/Redis-key itself (e.g., `WHERE tenant_id = $1 AND aggregate_id = $2`, or Redis keys namespaced `proj:{tenant_id}:...`), not just filtered after the fact in application code. Business decisions (e.g., "should the DNS Action run") are made by replaying events queried from Postgres for that `tenant_id`+aggregate, never from the Redis projection, per the explicit guardrail.
- **Rationale**: Satisfies FR-012/FR-013 and SC-003 at the data-access layer, where a missed `tenant_id` filter is structurally impossible to forget (it's a required parameter of the only functions allowed to touch storage), rather than relying on every call site remembering to filter.
- **Alternatives considered**: Postgres native Row-Level Security (RLS) policies — a reasonable alternative/defense-in-depth layer; noted as a candidate hardening step for a later iteration rather than a v1 requirement, since the repository-level enforcement above already satisfies the functional requirement without the added operational complexity of managing RLS policies alongside application-level tenancy.

## 9. Projections (Redis read models)

- **Decision**: Redis holds rebuildable projections only (e.g., device lists, last-known-IP-for-display, execution history pages for the UI). Each projection is versioned/tagged with the event sequence it was built through, and can be dropped and rebuilt from Postgres at any time with no data loss, since Redis is never the source of truth.
- **Rationale**: Matches "Projektionen sind rein disponibel" directly; also gives a natural mechanism for the horizontal-scalability requirement (any instance can rebuild any projection on demand, e.g., on cache miss).
- **Alternatives considered**: Materialized views in Postgres — plausible future optimization, deferred since Redis was explicitly specified for this role.

## 10. Replay performance metrics

- **Decision**: Every aggregate replay (rebuilding state by reading its event stream) is timed and instrumented via `prom-client`, exposing a histogram (e.g. `fluxip_replay_duration_seconds`) and a counter of events replayed, both labeled by `aggregate_type` (and `ip_client_id` where relevant). Metrics are exposed on a `/metrics` endpoint for Prometheus scraping.
- **Rationale**: Directly implements the explicit requirement to measure and expose replay cost from day one, so degrading aggregates (candidates for future snapshotting) are visible before snapshots are built.
- **Alternatives considered**: Ad hoc logging instead of metrics — rejected, doesn't support the stated goal of trend visibility across aggregates over time.

## 11. Testing strategy

- **Decision**: Vitest for unit tests (pure domain/aggregate logic, no I/O) and integration tests; Testcontainers to spin up real Postgres + Redis for contract/integration tests of the event-store and queue adapters, rather than mocking either.
- **Rationale**: The domain/hexagonal split makes pure unit testing of aggregates straightforward; testing the Postgres/BullMQ adapters against the real thing (via Testcontainers) is more trustworthy than mocking a database for code whose entire job is correct concurrency/idempotency behavior.
- **Alternatives considered**: Jest — Vitest chosen instead for native ESM/TS speed; not a hard requirement, easy to swap if the team has an existing preference.

## 12. Account deletion vs. immutable event log (tension, resolved)

- **Decision**: Account closure (FR-032) performs an explicit, synchronous **hard delete** of every event row for that `tenant_id` across all aggregates, plus removal of any in-flight BullMQ jobs referencing that tenant and any Redis projection keys namespaced to it. This is a deliberate, narrow exception to "events are never deleted."
- **Rationale**: FR-032 requires *immediate and permanent* erasure with *no recovery period*. That is incompatible with pure event-log immutability (a tombstone/redaction event would still leave the original PII-bearing events in place until some later purge job runs, violating "immediate"). Treating it as one explicit, audited exception is more honest than inventing a soft-delete mechanism that doesn't actually meet the requirement.
- **Alternatives considered**: (a) Tombstone event + async purge job — rejected, doesn't satisfy "immediate"; (b) crypto-shredding (per-tenant encryption key, delete the key) — plausible future hardening, rejected for v1 as disproportionate given the "pragmatic, not dogmatic" architecture guardrail and no stated compliance driver requiring it yet.

## 13. Notification delivery (email)

- **Decision**: An email `NotificationChannel` adapter behind the same kind of port used for Actions, sending via SMTP (e.g., `nodemailer`) with connection details from environment variables; the specific transactional-email provider (or self-hosted SMTP relay) is a deployment-time choice, not baked into the code.
- **Rationale**: Keeps the "additional channel types can be added later" requirement (FR-031) cheap — a new adapter implementing the same port — and avoids hardcoding a specific vendor the user didn't name.
- **Alternatives considered**: A specific vendor SDK (e.g., a proprietary transactional-email API) — rejected for v1 in favor of SMTP as the most portable, vendor-neutral default; swapping in a vendor SDK later is a new adapter, not a domain change.

## 14. IP Client reporting credential generation

- **Decision**: An IP Client's reporting credential (the secret used by FR-004/FR-005 to authenticate inbound reports, and rotated per FR-019) is **always system-generated** — a high-entropy random value (e.g. 256 bits, base62-encoded) — and is never user-chosen. Only a salted hash of it is persisted (in the `ip_client` aggregate's state, alongside the events, similar to password storage); the plaintext value is returned to the user exactly once, at creation and at each rotation, in the command's HTTP response, and is never written into any event payload or log.
- **Rationale**: User-chosen credentials for an internet-facing DynDNS-style endpoint are a common weak-password attack surface; auto-generation guarantees sufficient entropy. Storing only a hash (not the plaintext, not even encrypted) means a database read of the event store can never leak a usable credential, matching the "never exposed to any user other than the owning account" spirit of FR-016 extended to this credential too.
- **Alternatives considered**: Allowing the user to set/see their own credential value long-term — rejected outright per explicit instruction; also weaker security posture (reusable/guessable values, no forced entropy floor). Storing the plaintext encrypted (reversible) instead of hashed — rejected because the system only ever needs to *verify* this credential, never send it anywhere itself, so a one-way hash (as for passwords) is strictly safer than a reversible encryption scheme.

## 15. Account password change (resolves the FR-002 / Logto-delegation tension)

- **Decision**: The user changes their password from within FluxIP's own account settings UI (not a redirect/embed of Logto's hosted UI), symmetric with in-app account deletion. The FluxIP backend proxies the request to **Logto's Management API** using a dedicated machine-to-machine application's client-credentials token (`LOGTO_MANAGEMENT_CLIENT_ID`/`LOGTO_MANAGEMENT_CLIENT_SECRET`/`LOGTO_MANAGEMENT_API_BASE_URL`), addressing the same Logto user ID already used as `tenant_id` elsewhere. The new password value passes through the FluxIP backend only transiently, for that single upstream call — it is never logged, persisted, or included in any event payload.
- **Rationale**: Satisfies the product requirement that password change feels native inside FluxIP (FR-002) while keeping Logto as the sole system of record for credentials (research.md §7) — FluxIP still never *stores* a password; it only *relays* one, once, on the authenticated user's own behalf.
- **Alternatives considered**: Redirecting/embedding Logto's own hosted account-settings page — rejected per explicit product preference for a native in-app experience; FluxIP performing its own password hashing/storage — rejected, directly contradicts the "Logto owns auth" guardrail from research.md §7.

## 16. Administrator role provisioning (resolves the FR-034 admin-provisioning gap)

- **Decision**: An account gains Administrator capability by having its Logto identity assigned a dedicated role/custom claim (e.g. `fluxip_admin`) directly in Logto's own console — an out-of-band, operational action, not a FluxIP feature. FluxIP's `/admin/*` guard middleware (data-model.md Actors; tasks.md's admin-guard task) only ever *checks* for this claim on the verified OIDC token; it never grants, revokes, or manages it itself in this iteration.
- **Rationale**: Consistent with the "Administrator" Key Entity in spec.md already being scoped to "adjusting a user's Trigger Device limit" with "a broader administrative console... out of scope" — provisioning the role itself is equally out of scope for v1, and Logto (the already-chosen identity provider) is the natural place to manage it rather than building a second, FluxIP-owned admin-management surface.
- **Alternatives considered**: A FluxIP-native "grant admin" endpoint/UI — rejected as unnecessary scope for an iteration that only needs one narrow admin capability (device-limit override); revisit if/when the admin surface grows.

## 17. IP Client reporting protocol

- **Decision**: The trigger-ingestion HTTP endpoint implements the widely-deployed **dyndns2** update protocol subset (`GET /nic/update?hostname=...&myip=...`, HTTP Basic Auth using the IP Client's own reporting credential from FR-004), since this is exactly what FritzBox's native "custom DynDNS provider" configuration screen speaks, and optionally accepts a `myip6` parameter for IPv6 reporting (feeding FR-025's per-address-family Action configuration).
- **Rationale**: This is the concrete mechanism behind the spec's "DynDNS-compatible update mechanism" assumption — picking the de facto standard (dyndns2, used by dyndns.org/no-ip and natively supported by FritzBox's UI) needs no custom firmware or scripting on the user's router.
- **Alternatives considered**: A bespoke JSON API — rejected as the primary mechanism since it would require every user to script their router rather than using its built-in DynDNS client; could still be added later as a second adapter behind the same trigger-ingestion port.
