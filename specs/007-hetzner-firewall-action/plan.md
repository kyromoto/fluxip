# Implementation Plan: Hetzner Cloud Firewall Rule Action

**Branch**: `007-hetzner-firewall-action` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-hetzner-firewall-action/spec.md`

## Summary

Adds a second `ActionExecutor` implementation — a Firewall Rule Update Action that keeps one rule of one Hetzner Cloud Firewall's address list synchronized with a Trigger Device's IP address(es), touching only the CIDR entries it previously added itself. It extends the existing `action` aggregate (new `type`, a new `UpdateFirewallRuleConfig` config variant, a new `firewallOwnedEntries` piece of derived state) rather than introducing a new aggregate, reuses the existing Hetzner Provider Credential type, and reuses the existing Action-configuration wizard and execution-history UI. The two genuinely new mechanisms are: a short-TTL Redis lock guarding the unavoidable read-modify-write against `set_firewall_rules` (which replaces a rule's whole address list in one call), and a worker-appended domain event (`action.firewall_rule_applied`) that records what the worker last wrote, so the next run knows exactly which entry to replace without touching anything else in the rule.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS (backend), SolidJS + TypeScript (frontend) — both existing packages in the current pnpm workspace, unchanged.

**Primary Dependencies**: Backend — the existing `ActionExecutor` port and `action-execution-worker.ts`/BullMQ wiring, the existing Postgres-backed `EventStore` port, the existing `secret-encryption.ts` module (reused unmodified to decrypt the Hetzner credential), `ioredis` (already a dependency via BullMQ) for the new advisory lock. Frontend — the existing wizard step machinery (`useWizard`, `WizardShell`) and UI primitives already used by `DnsTargetStep`. No new runtime dependency on either side.

**Storage**: PostgreSQL (append-only event store, unchanged) — the new `action.firewall_rule_applied` event lives on the existing `action` aggregate stream. Redis gains one new, narrowly-scoped use: an advisory lock key (`firewall-lock:{accountId}:{firewallId}`) around firewall read-modify-write cycles — not a projection, not persisted state, just short-TTL mutual exclusion.

**Testing**: Vitest for backend unit tests (the pure `matchFirewallRule` selector-matching function; the executor's own-entries-only mutation logic) and contract tests (config-time validation error shapes); Testcontainers-backed integration test for the full attach → execute → execute-again → reconfigure-drops-family → detach lifecycle, including a concurrent-update case exercising the lock; frontend unit test for the new wizard step; one Playwright addition to the existing action-wizard suite.

**Target Platform**: Unchanged — Docker/Linux server (backend) + evergreen browsers (frontend).

**Project Type**: Web application — existing `backend/` + `frontend/` pnpm workspace; this feature touches both.

**Performance Goals**: Matches SC-002 (99% of confirmed IP changes reflected in the firewall rule within 5 minutes) — the same propagation-latency bar 001 set for the DNS Action, achieved the same way (async execution via the existing BullMQ queue, not the synchronous trigger-ingestion path).

**Constraints**: FR-006 — every write MUST only touch this Action's own previously-written entries, never other entries in the rule; FR-009 — no lost updates between concurrent FluxIP-initiated writes to the same firewall (not guaranteed against a concurrent manual Hetzner Console edit — spec.md Clarifications); FR-011/FR-017 — best-effort cleanup on detach/family-removal MUST NOT block the triggering request and MUST NOT auto-retry; FR-018 — the rule selector MUST be validated against live Hetzner state at configuration time, before any domain event is appended.

**Scale/Scope**: Same account-level scale as 001 — one rule per Action instance (spec.md Assumptions), a user attaches multiple Actions for multiple rules; SC-004 requires zero lost updates across at least 100 concurrent update pairs targeting the same firewall.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` defines a single ratified principle, **Explicit Commit Authorization**, a process rule for the assistant that does not gate any technical decision in this plan. No other principles are defined. The architecture guardrails 001 established as this codebase's de facto constraints (pragmatic hexagonal architecture; a port only where a real second implementation exists; event sourcing with Postgres as the store of record; Redis projections/locks as disposable, never a decision source) remain in force and are what this plan is checked against below.

- **`ActionExecutor` port**: no change to the port itself — this feature is the *second* concrete implementation the port's own doc comment already anticipated ("Hetzner firewall and other providers later"), which is exactly the condition 001 set for a port to exist at all.
- **Two deliberate, scoped new patterns** (both called out explicitly in research.md rather than introduced silently): (1) the action-execution worker appends to the `action` aggregate stream for the first time (research.md §1/§4) — previously only the four `actions.ts` HTTP handlers wrote to it; (2) the Management API's attach/reconfigure routes make a synchronous third-party network call (Hetzner) for the first time (research.md §6) — previously routes only replayed local aggregates. Both are scoped to this one Action type, not a general pattern change, and both are justified by a direct spec requirement (FR-007/ownership-tracking and FR-018/eager-validation respectively) rather than convenience.
- **No new projection**: `firewallOwnedEntries` rides the existing `action` aggregate's replay path (the worker already loads it every execution); no Redis read model is added for it.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/` confirm the above holds — one extended aggregate, one extended port implementation, no new aggregate/port/projection. The advisory Redis lock (research.md §2) is infrastructure, not a projection or decision source, consistent with 001's "Redis never backs a business decision" rule (the lock only serializes *access*; what to write is still decided from Postgres-replayed `action` state and a live Hetzner read). No violations; nothing to record in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/007-hetzner-firewall-action/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   ├── actions-api.md
│   └── hetzner-firewall-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── domain/action/
│   │   ├── events.ts                        # MODIFIED — HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE,
│   │   │                                     #            UpdateFirewallRuleConfig, ActionFirewallRuleAppliedData
│   │   ├── action-aggregate.ts               # MODIFIED — reducer folds firewall_rule_applied into firewallOwnedEntries
│   │   └── firewall-rule-selector.ts         # NEW — pure matchFirewallRule(rules, selector); shared by route + executor
│   ├── adapters/actions/
│   │   └── hetzner-firewall/
│   │       ├── hetzner-firewall-client.ts     # NEW — thin Hetzner Cloud API client (GET firewall, set_firewall_rules)
│   │       ├── hetzner-firewall-lock.ts       # NEW — Redis SET NX PX advisory lock, keyed firewall-lock:{accountId}:{firewallId}
│   │       └── hetzner-firewall-executor.ts   # NEW — ActionExecutor implementation; owns the locked read-modify-write
│   ├── adapters/queue-bullmq/
│   │   └── action-execution-worker.ts        # MODIFIED — resolveFirewallExecutorConfig; appends firewall_rule_applied
│   │                                          #            with reload-and-retry-once on version conflict (research.md §4)
│   └── adapters/http/routes/
│       └── actions.ts                        # MODIFIED — accepts the firewall config variant; FR-018 eager validation
│                                              #            on POST/PUT; best-effort cleanup call on DELETE and on a
│                                              #            family-dropping PUT (research.md §3)
└── tests/
    ├── unit/domain/firewall-rule-selector.test.ts          # NEW
    ├── unit/adapters/actions/hetzner-firewall-executor.test.ts  # NEW
    ├── contract/actions.test.ts                            # NEW — FR-018 validation error shapes
    └── integration/firewall-rule-action-lifecycle.test.ts  # NEW — attach → execute → execute-again →
                                                              #      reconfigure-drops-family → detach, incl. lock contention

frontend/
├── src/
│   ├── flows/action-wizard/
│   │   ├── steps/
│   │   │   └── FirewallRuleTargetStep.tsx    # NEW — mirrors DnsTargetStep.tsx: credential select + firewallId/
│   │   │                                     #       direction/protocol/port/description fields
│   │   ├── steps/ChooseActionTypeStep.tsx    # MODIFIED — offers both Action types as selectable cards
│   │   └── ActionWizard.tsx                  # MODIFIED — ActionWizardData union gains the firewall config fields
│   └── lib/credential-types.ts               # UNCHANGED — "hetzner" already maps to a friendly label, reused as-is
└── tests/
    └── unit/firewall-rule-target-step.test.tsx  # NEW
```

**Structure Decision**: No change to the existing `backend/` + `frontend/` pnpm workspace split. The new Action type is added as a sibling adapter under `backend/src/adapters/actions/hetzner-firewall/`, exactly the seam `adapters/actions/hetzner-dns/`'s own doc comment reserved for it. `domain/action/firewall-rule-selector.ts` is the only new *domain* file — pure logic with two call sites (route + executor), which is what earns it a shared home rather than living inside the adapter. The frontend's only new file is the wizard step; `ChooseActionTypeStep`/`ActionWizard` are edited in place, not restructured.

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
