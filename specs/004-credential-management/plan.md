# Implementation Plan: Provider Credential Management (Zugangsdaten-Verwaltung)

**Branch**: `004-credential-management` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-credential-management/spec.md`

## Summary

Extends the existing, already-partially-implemented `provider_credential` aggregate (from 001-ip-change-automation) with the UI and API surface this addendum requires: a dedicated `frontend/src/pages/Credentials.tsx` area for creating, listing (masked-only), and deleting named credential entries; a masked-value fragment stored at creation time so the full secret is never retrievable after `POST` (FR-004a); a case-insensitive name-uniqueness check; and a delete guard that blocks removal while any Action (enabled or disabled) still references the entry, surfacing which ones. The existing Action wizard's `DnsTargetStep` already lets a user pick a stored Hetzner credential from a dropdown (built in 003-end-user-ui-redesign) — this plan adds the missing "no credentials yet" path as an inline create-dialog on that same step, so the in-progress Action configuration is never lost. No new aggregate, no new backend package, no new frontend runtime dependency.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS (backend), SolidJS + TypeScript (frontend) — both existing packages in the current pnpm workspace, unchanged.

**Primary Dependencies**: Backend — Hono, the existing Postgres-backed `EventStore` port, the existing AES-256-GCM `secret-encryption.ts` module (reused unmodified), `ulid`. Frontend — the existing Solid UI components already in `frontend/src/components/ui/` (`dialog`, `select`, `text-field`, `card`, `alert`, `button`), `@solidjs/router`. No new runtime dependency is introduced on either side.

**Storage**: PostgreSQL (append-only event store, unchanged) via the existing `provider_credential` aggregate stream. No new Redis projection: the Credentials list stays served by direct aggregate replay per account, exactly as the existing `GET /provider-credentials` already does — bounded by SC-006's small scale (≥5 entries), not by list volume that would justify a projection.

**Testing**: Vitest for backend unit/contract tests (name-uniqueness rule, masked-value derivation, delete-block logic) and frontend unit tests (Credentials page, DnsTargetStep's empty-state dialog); Testcontainers-backed integration test for the full create → attach-to-Action → delete-blocked → detach → delete-succeeds lifecycle; one new Playwright smoke path extending 003's existing wizard suite (Action wizard with zero credentials → inline create → resume → complete).

**Target Platform**: Unchanged — Docker/Linux server (backend) + evergreen browsers (frontend).

**Project Type**: Web application — existing `backend/` + `frontend/` pnpm workspace; this feature touches both.

**Performance Goals**: No new numeric target. Credential CRUD and the delete-reference check are bounded by one account's credential/Action counts (both small per SC-006) and complete within the same synchronous-request expectations as the existing Provider Credential and Action endpoints.

**Constraints**: FR-004a — the full secret value MUST NOT appear in any response after the initial `201 Created`; the delete-reference check MUST replay authoritative Postgres aggregate state, never the disposable Redis projections (001's cross-cutting rule #3); this feature extends the existing `provider_credential` aggregate rather than introducing a parallel one; the in-wizard credential-creation path MUST NOT lose any Action-configuration data already entered in earlier wizard steps (FR-012/013).

**Scale/Scope**: Same account-level scale as 001/003 — SC-006 requires at least 5 simultaneously active, independently named credential entries of one Credential Type with no selection ambiguity.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` defines a single ratified principle: **Explicit Commit Authorization** (commits only on explicit user request, Conventional Commits derived from the diff and prior history). It is a process rule for the assistant, not a design constraint, and does not gate any technical decision in this plan. No other principles are defined. No violations.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/` extend the existing `provider_credential` aggregate in place (new field on an existing event, one new route-level guard, no new aggregate or projection). Still no formal gates to violate; nothing to record in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/004-credential-management/
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
│   ├── domain/provider-credential/
│   │   ├── events.ts                       # MODIFIED — add `secretLast4` to Stored event data
│   │   └── provider-credential-aggregate.ts # MODIFIED — reducer carries `secretLast4` in derived state
│   └── adapters/http/routes/
│       └── provider-credentials.ts         # MODIFIED — POST: name-uniqueness check + secretLast4;
│                                            #            GET: return masked value + type;
│                                            #            NEW: DELETE (blocked-if-referenced, 409 + usedBy list)
└── tests/
    ├── contract/provider-credentials.test.ts        # EXTENDED — POST validation, GET shape, DELETE contract
    └── integration/provider-credential-lifecycle.test.ts  # NEW — create → attach → delete blocked → detach → delete

frontend/
├── src/
│   ├── pages/
│   │   └── Credentials.tsx                 # NEW — dedicated "Credentials" area (User Story 1)
│   ├── components/credentials/
│   │   └── CredentialFormDialog.tsx         # NEW — shared create-credential form (used by Credentials.tsx and the wizard's empty-state dialog)
│   ├── lib/
│   │   └── credential-types.ts              # NEW — Credential Type → friendly display-label map (e.g. "hetzner" → "Hetzner API Token")
│   ├── flows/action-wizard/steps/
│   │   └── DnsTargetStep.tsx                # MODIFIED — "add a credential" affordance + inline create dialog when the list is empty (User Story 2)
│   ├── components/layout/AppShell.tsx       # MODIFIED — new "Credentials" nav link
│   └── App.tsx                              # MODIFIED — new `/credentials` route
└── tests/
    ├── unit/credentials-page.test.ts        # NEW
    └── unit/dns-target-step.test.ts         # NEW — empty-state → inline create → resume behavior
```

**Structure Decision**: No change to the existing `backend/` + `frontend/` pnpm workspace split. All backend changes extend the existing `provider-credential` domain/route files already created in 001; no new backend module, port, or projection. All frontend changes live inside the existing `pages/`, `flows/action-wizard/`, and `components/` directories established in 003; the only new directory is `components/credentials/` for the one shared create-credential form used from two places.

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
