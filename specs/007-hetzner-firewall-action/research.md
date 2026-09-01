# Phase 0 Research: Hetzner Cloud Firewall Rule Action

No `[NEEDS CLARIFICATION]` markers remained in `spec.md` after the `/speckit-clarify` session, so this phase focuses on choosing concrete mechanisms for the behavior the spec and its Clarifications already pinned down, and reconciling them with the existing `action` aggregate, `ActionExecutor` port, and HTTP routes built in 001-ip-change-automation.

## 1. Ownership tracking lives on the `action` aggregate's own event stream, not labels or execution history

**Decision**: A new event, `action.firewall_rule_applied`, is appended to the existing `action` aggregate stream (parallel to `action.reconfigured`) after every successful firewall write. It carries only the address-family → CIDR pairs actually written in that execution: `{ ipv4?: string, ipv6?: string, appliedAt }`. The reducer folds it into a new `firewallOwnedEntries: { ipv4?: string; ipv6?: string }` field on `ActionState`, overwriting only the families present in the event.

**Rationale**: `action-execution-worker.ts` already loads the full `action` aggregate on every execution (`action-execution-worker.ts:214-219`) to read `addressFamilies`/`config`/`status` — folding ownership into that same state means the executor's "what did I last write" question is answered by data it already has in hand, with no additional read. It also stays fully event-sourced and inspectable via the same replay mechanism as everything else in the system, rather than introducing a second source of truth.

**Alternatives considered**:
- *Hetzner firewall labels* — rejected. Labels attach to the firewall resource as a whole, not to individual `source_ips` entries, so they cannot by themselves disambiguate "which entry is mine" within a rule; using them would still require the same per-Action state, just stored on a third-party resource instead of in FluxIP's own event store, adding a network round-trip and a drift-detection problem (what if the label and the actual rule content disagree?) with no offsetting benefit for this iteration.
- *Deriving from the `action_execution` history/projection* — rejected. `action_execution` is its own aggregate per execution (keyed by `executionId`, not `actionId`), and `executions-projection.ts`'s `listExecutionsProjection` returns an unordered Redis hash with no time-ordering or "most recent" query today. Building that sort/filter capability would be strictly more work than folding a small event into an aggregate the worker already loads, for the same information — confirmed unnecessary because `ipValues` on every execution already reflects the IP Client's full current state for every address family the Action was watching at that time (`debounce-worker.ts:57-58`, `action-run.ts:67-70` always resolve both families from `lastKnownIPv4`/`lastKnownIPv6`, never a partial delta), so no "scan back N executions" logic is ever needed even in principle.

**Consequence**: this is the first event any code *other than* the four `actions.ts` HTTP handlers (attach/reconfigure/enable-disable/detach) appends to the `action` aggregate stream — see §4 for the concurrency handling this introduces.

## 2. Read-modify-write against a firewall is guarded by a short-TTL Redis lock

**Decision**: Any code path that mutates a firewall's rules (the executor's normal update, and the best-effort removal in §3) first acquires an advisory lock keyed `firewall-lock:{accountId}:{firewallId}` (Redis `SET NX PX`, released via a token-checked Lua script so a holder never releases someone else's lock after its own TTL already expired it). The key is scoped by `accountId` as well as `firewallId` so two different accounts' credentials can never contend on (or, worse, be confused by) the same numeric Hetzner firewall ID. On failure to acquire within a short bounded wait, the caller throws; for the executor this means the job fails and falls back to the existing action-execution retry/backoff (`actionRetryAttempts`/`actionRetryBaseDelayMs`, already used by every Action type) instead of a bespoke retry loop.

**Rationale**: `set_firewall_rules` replaces a rule's entire `source_ips`/`destination_ips` array in one call — there is no partial-patch endpoint — so two concurrent read-modify-write cycles against the *same* firewall risk a lost update (FR-009). Redis is already a hard dependency (BullMQ, `ioredis`), so this adds no new infrastructure, and letting a lock-contention failure ride the existing retry/backoff avoids building a second queueing mechanism next to BullMQ's.

**Alternatives considered**:
- *BullMQ job grouping by firewall ID* — rejected; it would force the shared `action-execution` queue to special-case one Action type's jobs for serialization, entangling this feature with the queue's general-purpose contract for no real benefit over a scoped lock.
- *Optimistic concurrency against Hetzner's own state* — Hetzner's Firewall resource does not expose a version/ETag the Cloud API's `set_firewall_rules` action can be conditioned on, so true optimistic concurrency isn't available; a lock around FluxIP-initiated writes is the achievable guarantee (see also Clarifications: the no-lost-updates guarantee explicitly covers only FluxIP-initiated updates, not a concurrent manual edit in the Hetzner Console).

## 3. Detach/family-removal cleanup reuses the same read-modify-write path, one-shot, best-effort

**Decision**: `DELETE /actions/:id` (full detach) and `PUT /actions/:id` (when the new `addressFamilies` no longer includes a family present in `firewallOwnedEntries`) append their existing domain event first (`action.detached` / `action.reconfigured`, unblocked), then — for a Firewall Rule Update Action only — make a single, synchronous, best-effort attempt to remove the affected `firewallOwnedEntries` CIDR(s) from the live rule, using the same locked read-modify-write helper as normal execution (§2), just with nothing to add. Failure is caught, logged, and does not affect the HTTP response; there is no automatic retry (per Clarifications).

**Rationale**: Matches FR-010/FR-011/FR-017 and the Clarifications session exactly (one-shot, non-blocking, best-effort). Doing it inline in the same request — rather than a fire-and-forget background job — needs no new job type or queue for a single attempt with no retry semantics, and the added latency is a network call from a low-frequency, user-initiated request (detach/reconfigure), not the high-frequency IP-change path.

**Alternatives considered**: A BullMQ job for the cleanup attempt — rejected as needless machinery; a job type only earns its keep when it needs retry/backoff/observability beyond "try once, log if it fails," which is explicitly not required here.

## 4. Worker-appended `action` events use reload-and-retry-once on a version conflict, and are non-fatal

**Decision**: Appending `action.firewall_rule_applied` (§1) uses the same optimistic-concurrency append the HTTP routes already use (`expectedSequenceNumber`), computed from a fresh load of the `action` aggregate taken right before the append (not the one loaded at the start of the job, which may now be stale). If the append still conflicts (the user concurrently reconfigured/detached/toggled the same Action in the narrow window around its own execution), it is retried exactly once against a fresh reload; if it still fails, the failure is logged but does **not** fail the execution — the firewall write itself already succeeded and is what FR-005/SC-002 measure.

**Rationale**: This is the one place a background worker writes to an aggregate stream that, until now, only user-initiated HTTP requests wrote to (`action.attached`/`.reconfigured`/`.enabled`/`.disabled`/`.detached`, all in `actions.ts`). A version conflict here is a narrow, low-probability race (the user editing the same Action at the exact moment its own execution completes) with a low-severity failure mode: a stale `firewallOwnedEntries` value merely causes the *next* execution to treat that family as "first run" again (FR-007's append-only path), which safely no-ops the removal half (the stale CIDR is simply not found when filtering `source_ips`) rather than corrupting anything. That asymmetry — cheap to make rare, harmless if it still happens — justifies a bounded one-retry policy instead of either ignoring the conflict class entirely or building a more elaborate reconciliation mechanism.

**Alternatives considered**: Giving `action.firewall_rule_applied` its own aggregate (e.g. folded into `action_execution` instead) — rejected; `action_execution` is per-attempt and already discarded/summarized by the time the *next* attempt needs "what did I last apply," which is exactly the query §1 rejected building.

## 5. Rule-selector matching is one pure function, shared by config-time validation and execution

**Decision**: A pure, I/O-free function `matchFirewallRule(rules, selector)` (selector = `{ direction, protocol, port?, description }`) lives in `domain/action/` and returns either the single matching rule or a typed "none"/"ambiguous" result. Both the HTTP route (config-time validation, FR-018) and the executor (execution-time validation, FR-008) call it against whatever rule list they fetched, so the matching semantics can never drift between the two call sites.

**Rationale**: FR-008 and FR-018 are the same matching rule applied at two different times (configure vs. execute); implementing it twice would risk exactly the kind of silent divergence the fail-closed philosophy in both FRs is trying to avoid.

**Alternatives considered**: Duplicating the match logic inline in the route and the executor — rejected as an obvious drift risk for a two-line predicate that's cheap to share.

## 6. Config-time validation (FR-018) makes the HTTP route call out to Hetzner synchronously

**Decision**: `POST /ip-clients/:id/actions` and `PUT /actions/:id`, when the Action type/config is the Firewall Rule Update type, decrypt the referenced Provider Credential and call Hetzner's `GET /firewalls/{id}` inline in the request handler, run `matchFirewallRule` (§5) against the response, and reject with `400`/`422` if it doesn't resolve to exactly one rule — before any domain event is appended.

**Rationale**: Directly implements the Clarifications decision (eager validation, fail fast in the wizard rather than silently at the first real IP change, possibly days later).

**Consequence**: this is the first place a Management API route makes a synchronous third-party network call rather than only replaying local aggregates — existing routes only ever validate against other FluxIP aggregates (e.g. Provider Credential ownership/status). It's an accepted, scoped exception: config-time attach/reconfigure of this one Action type only, not a general pattern change.

**Alternatives considered**: Deferring all validation to first execution — rejected per the Clarifications session's explicit decision.
