# Implementation Plan: IP-Change-Triggered Automation (FluxIP Core)

**Branch**: `001-ip-change-automation` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ip-change-automation/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

FluxIP lets a user register, attach one or more IP Clients (the spec's "Trigger Device", e.g. a FritzBox) that report public-IP changes via a DynDNS-compatible endpoint, and configure per-client Actions (initially: update a Hetzner DNS record) that fire automatically and idempotently when a change is confirmed. The system is multi-tenant (isolation enforced at the data-access layer, no cross-tenant visibility), horizontally scalable (no in-process state), and built as an event-sourced system: Postgres is the append-only CloudEvents store and source of truth, Redis/BullMQ handle distributed, exactly-once job processing and disposable read-model projections, and a Hono/TypeScript backend + SolidJS frontend are packaged as Docker containers alongside Postgres, Redis, and a Logto OIDC identity provider.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS (backend and shared domain code); SolidJS + TypeScript (frontend); **pnpm** as the package manager, with a pnpm workspace (`pnpm-workspace.yaml`) spanning `backend/` and `frontend/`

**Primary Dependencies**: Hono (HTTP framework), BullMQ (Redis-backed job queue), `pg`/Kysely (typed Postgres access for the event store), a CloudEvents SDK (`cloudevents` npm package) for event envelope construction/validation, `jose` (JWKS-based OIDC token verification against Logto), a Logto Management API client (M2M client-credentials, for proxying in-app password changes — research.md §15), `prom-client` (Prometheus metrics), SolidJS + Vite (frontend)

**Storage**: PostgreSQL (append-only event store, source of truth); Redis (BullMQ queues + disposable, rebuildable projections — never a decision source)

**Testing**: Vitest for unit/integration tests; Testcontainers-driven contract/integration tests against real Postgres + Redis instances; no test framework was specified by the user, so this is a planning-time default, not a locked-in decision

**Target Platform**: Linux server, delivered as Docker containers (app, Postgres, Redis, Logto each separate); horizontally scaled behind a load balancer

**Project Type**: Web application (Hono backend + SolidJS frontend)

**Performance Goals**: Trigger-ingestion endpoint acknowledges an inbound IP-change report in <200ms p95 (actual Action execution happens asynchronously via BullMQ); satisfies spec SC-002 (99% of confirmed changes reflected in DNS within 5 minutes) and SC-007 (99% of enabled notifications delivered within 1 minute)

**Constraints**: No in-memory or single-instance-local state anywhere in the request/processing path (FR-015); event store rows are immutable/append-only except for the explicit, deliberate account-deletion hard-delete (see research.md); tenant filtering enforced at the data-access layer, not only in application logic; configuration exclusively via environment variables, no config files baked into the image; CloudEvents `source` and `type` prefix are environment-configured, never hardcoded

**Scale/Scope**: Single-tenant-per-user model (no organizations/multi-member tenants) on a shared multi-instance deployment; SC-005 requires at least 10 IP Clients per user with no degradation; SC-004 requires correctness (no dupes/drops) across ≥1,000 concurrently processed IP-change reports

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unedited template (all principles are unfilled placeholders) — no project has been ratified yet, so there are no formal gates to evaluate against. The architecture guardrails supplied for this feature (pragmatic hexagonal architecture, no separation without a real second adapter, event sourcing with Postgres as the store of record, projections as disposable Redis read models that never back business decisions) are treated as this plan's de facto constraints instead, and are reflected in the Project Structure and research.md below.

**Recommendation**: run `/speckit-constitution` at some point to formally ratify these architecture guardrails so future features are checked against them automatically, rather than re-stating them per-plan.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/` were reviewed against the same guardrails — `ports/` only exists for the event store and Action/notification-channel adapters (the two places research.md identifies a real, imminent second implementation); no port was introduced for internal-only logic (e.g. debounce scheduling, credential hashing) that has no second adapter in sight. Still no formal constitution gates to violate. No new complexity requiring justification in Complexity Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── domain/              # aggregates, event payloads/types, pure business rules — the hexagon core, no I/O
│   ├── ports/                # interfaces the domain depends on (EventStore, ActionExecutor, Clock, ProviderCredentialVault, ...)
│   ├── adapters/
│   │   ├── event-store-postgres/   # Postgres-backed EventStore port implementation (append + stream read)
│   │   ├── queue-bullmq/           # BullMQ producer/worker wiring for async event processing
│   │   ├── actions/
│   │   │   └── hetzner-dns/        # first ActionExecutor adapter; future providers (firewall, etc.) live as siblings
│   │   ├── auth-logto/             # OIDC/JWKS token verification middleware
│   │   ├── notifications-email/    # first NotificationChannel adapter
│   │   └── http/                   # Hono routes: DynDNS-style trigger endpoint + management API
│   ├── projections/          # Redis-backed, disposable read models rebuilt from the event store
│   └── config/                # environment-variable loading/validation (12-factor)
└── tests/
    ├── contract/              # HTTP contract tests for the trigger endpoint + management API
    ├── integration/           # Testcontainers-backed Postgres/Redis/BullMQ flow tests
    └── unit/                  # domain/aggregate logic, no I/O

frontend/
├── src/
│   ├── components/
│   ├── pages/                 # account, IP clients, actions, execution history, notification settings
│   └── services/              # typed client for the backend management API
└── tests/
```

**Structure Decision**: Web application split into `backend/` (Hono + TypeScript) and `frontend/` (SolidJS), per Option 2 of the template. Within `backend/`, a pragmatic hexagonal layout is used: `domain/` never imports from `adapters/`; `ports/` defines the seams that actually have (or will imminently have) more than one implementation — the event store (Postgres today, swappable later) and Action/notification providers (Hetzner DNS today, Hetzner firewall and other channels later). Internal helper logic with no plausible second adapter (e.g., request validation, env parsing) stays undecorated in `config/`/`http/` rather than being forced behind a port.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
