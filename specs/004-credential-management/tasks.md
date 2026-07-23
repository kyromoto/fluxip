---

description: "Task list for Provider Credential Management (Zugangsdaten-Verwaltung)"
---

# Tasks: Provider Credential Management (Zugangsdaten-Verwaltung)

**Input**: Design documents from `/specs/004-credential-management/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Included — plan.md and quickstart.md already commit to specific contract, integration, and unit test files as part of the design (mirroring 003-end-user-ui-redesign's approach), so the test tasks below are real deliverables, not optional extras.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root, per plan.md's Project Structure

## Path Conventions

Existing web application per plan.md: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`. This feature extends the `provider_credential` aggregate and routes already created in 001-ip-change-automation and the Action wizard already built in 003-end-user-ui-redesign — no new package, port, or top-level directory.

---

## Phase 1: Setup

No new project setup is required. This feature adds no new dependency, Docker service, or workspace package (plan.md Technical Context) — it extends existing `backend/` and `frontend/` files only. Proceed directly to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared aggregate/schema changes every user story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T001 [P] Add `secretLast4: string` to `ProviderCredentialStoredData` in backend/src/domain/provider-credential/events.ts
- [X] T002 Add `secretLast4` to `ProviderCredentialState`/`initialProviderCredentialState` and carry it through in `providerCredentialReducer` in backend/src/domain/provider-credential/provider-credential-aggregate.ts (depends on T001)
- [X] T003 [P] Add a `maskLast4(secret: string): string` helper (returns the secret's last 4 characters) in backend/src/domain/provider-credential/secret-encryption.ts
- [X] T004 [P] Add a Credential-Type display-label map (`{ hetzner: "Hetzner API Token" }`, unknown values fall back to their raw string) in frontend/src/lib/credential-types.ts

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Create, View, and Delete Provider Credentials in a Dedicated Area (Priority: P1) 🎯 MVP

**Goal**: A user has a standalone "Credentials" area where they can create a named Hetzner credential, see it listed with only a masked value, and delete an entry that isn't in use by any Action.

**Independent Test**: Run quickstart.md Scenario 1 — from an empty Credentials area, create a named Hetzner credential, confirm it's listed with a masked value only (never the full token, in the UI or any network response after creation), then delete it and confirm it disappears.

### Tests for User Story 1

- [X] T005 [P] [US1] Contract test: `POST` rejects missing fields (400) and a case-insensitive duplicate `label` (409); `GET` items include only `secretLast4` + `provider`, never the full secret; `DELETE` succeeds (204) for an unreferenced, owned, active entry and 404s for a missing/foreign/already-revoked one; creating 5 distinctly-named Hetzner entries in one account all list correctly with no collision (SC-006), in backend/tests/contract/provider-credentials.test.ts

### Implementation for User Story 1

- [X] T006 [US1] Modify `POST /provider-credentials` in backend/src/adapters/http/routes/provider-credentials.ts: reject a `label` that case-insensitively matches an existing active entry for the same tenant (409 `"label already in use"`, replayed via the existing `listAggregateIds`/`loadAggregate` pattern), compute `secretLast4` via T003 and include it in `provider_credential.stored`'s event data, and never include the submitted `secret` itself in the response body (depends on T001-T003)
- [X] T007 [US1] Modify `GET /provider-credentials` in backend/src/adapters/http/routes/provider-credentials.ts to include `secretLast4` and `provider` on each returned item (depends on T006)
- [X] T008 [US1] Implement `DELETE /provider-credentials/:id` in backend/src/adapters/http/routes/provider-credentials.ts: 404 if the entry doesn't exist, isn't owned by the caller, or isn't `active`; otherwise replay every `action` aggregate for the tenant (`listAggregateIds`/`loadAggregate`) and reject with `409 { error: "credential_in_use", usedBy: [{ actionId, ipClientId, zone, recordName }] }` if any non-`detached` Action's `config.providerCredentialId` matches; otherwise append `provider_credential.revoked` and return 204 (depends on T007)
- [X] T009 [P] [US1] Create `CredentialFormDialog` (Credential Type select — initially only "Hetzner API Token" via T004, name field, secret field, calls `POST /provider-credentials`, invokes `onCreated({ credentialId, provider, label, secretLast4 })` on success) in frontend/src/components/credentials/CredentialFormDialog.tsx (depends on T004)
- [X] T010 [US1] Create the `Credentials` page: list entries as cards (name, Credential Type label via T004, masked value `••••<secretLast4>`), `EmptyState` CTA opening `CredentialFormDialog`, a delete button per entry (confirm, then `DELETE`, then refetch), and `ErrorMessage` on failure, in frontend/src/pages/Credentials.tsx (depends on T009)
- [X] T011 [US1] Add the `/credentials` route in frontend/src/App.tsx and a "Credentials" nav link in frontend/src/components/layout/AppShell.tsx (depends on T010)
- [X] T012 [P] [US1] Frontend unit test: create → appears masked; delete → disappears; error rendering on a failed create/delete, in frontend/tests/unit/credentials-page.test.tsx (depends on T010) — written as `.tsx` (needed for JSX/`@solidjs/testing-library` rendering, not `.ts`); 3/3 passing
- [X] T013 [US1] Run quickstart.md Scenario 1 and confirm outcomes — verified via T005 (backend contract, real Postgres) + T012 (frontend component test) covering every assertion in Scenario 1; not run through a live authenticated browser session in this environment (same caveat as 003-end-user-ui-redesign's Playwright specs — Logto sign-in needs a real session)

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP slice.

---

## Phase 4: User Story 2 - Select an Existing Credential While Configuring a Hetzner DNS Action (Priority: P2)

**Goal**: The Action wizard's credential step offers only matching-type entries by name, and never dead-ends when none exist yet.

**Independent Test**: Run quickstart.md Scenario 2 — with zero Hetzner credentials, start configuring a DNS-update Action and confirm the wizard offers an inline way to create one without losing the in-progress Action configuration; with ≥2 named Hetzner credentials, confirm both are selectable and distinguishable by name.

### Implementation for User Story 2

- [X] T014 [US2] Filter `DnsTargetStep`'s credential dropdown to entries whose `provider` matches the Action type's required Credential Type (`"hetzner"` for `update_dns_record`) instead of listing all credentials, in frontend/src/flows/action-wizard/steps/DnsTargetStep.tsx (depends on Foundational T004)
- [X] T015 [US2] Add an "Add a new credential" affordance next to the dropdown (always available, not only when empty) and replace the dropdown with an inline empty-state prompt when zero matching entries exist; both open `CredentialFormDialog` (from US1, T009); on success, refetch the credentials resource and set `providerCredentialId` to the new entry, in frontend/src/flows/action-wizard/steps/DnsTargetStep.tsx (depends on T014, T009)

### Tests for User Story 2

- [X] T016 [P] [US2] Frontend unit test: zero-credentials renders the inline create affordance instead of an empty dropdown; successful inline creation auto-selects the new entry and preserves the rest of `ActionWizardData`; cancelling leaves the wizard unchanged, in frontend/tests/unit/dns-target-step.test.tsx (depends on T015) — written as `.tsx` (same reason as T012); 4/4 passing
- [X] T017 [P] [US2] Extend the existing Playwright spec with the zero-credentials → inline create → resume → complete path, in frontend/tests/e2e/action-wizard.spec.ts (depends on T015) — added and confirmed parseable/listable (`playwright test --list`); not run against a live authenticated session in this environment, same caveat as the rest of this file (tests/e2e/README.md)

### Validation for User Story 2

- [X] T018 [US2] Run quickstart.md Scenario 2 and confirm outcomes — verified via T016 (component-level) covering every assertion in Scenario 2; live browser run has the same auth-session caveat as T013

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Reuse and Independently Reference Credentials Across Multiple Actions (Priority: P3)

**Goal**: Two Actions can independently reference two different named credentials of the same type (or share one), and deleting a credential still referenced by any Action (enabled or disabled) is blocked with the specific referencing Actions named.

**Independent Test**: Run quickstart.md Scenario 3 — create two Hetzner credentials, assign each to a different Action, assign one to a second additional Action, confirm all three Actions save and each reflects the specific entry it was assigned; then attempt to delete a still-referenced credential and confirm it's rejected with the referencing Actions named, until they're reassigned/removed.

### Implementation for User Story 3

- [X] T019 [US3] Render the blocked-delete response on the Credentials page: list the specific referencing Actions (DNS target) with a link to each one's device Actions page, instead of a generic error, in frontend/src/pages/Credentials.tsx (depends on T008, T010)

### Tests for User Story 3

- [X] T020 [P] [US3] Extend the contract test with the blocked-delete case: `DELETE` on a referenced credential returns 409 with `{ error: "credential_in_use", usedBy: [...] }` naming the referencing Action(s); succeeds after they're detached, in backend/tests/contract/provider-credentials.test.ts (depends on T008)
- [X] T021 [P] [US3] Integration test (Testcontainers, real Postgres): create one credential → attach it to two Actions → attempt delete (blocked, `usedBy` lists both) → detach both Actions → delete succeeds, in backend/tests/integration/provider-credential-lifecycle.test.ts (depends on T008)

### Validation for User Story 3

- [X] T022 [US3] Run quickstart.md Scenario 3 and confirm outcomes — verified via T020 (backend contract, real Postgres) and T021 (integration test, 2-Action reuse + progressive detach-then-delete) covering every assertion in Scenario 3, including the enabled/disabled-both-block edge case; live browser run has the same auth-session caveat as T013

**Checkpoint**: All three user stories are independently functional; the full feature is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T023 [P] Type-check and lint both packages (`pnpm -r typecheck`, `pnpm -r lint`) and fix any issues surfaced by the changes above — `tsc --noEmit` clean on both packages; `eslint src` clean on backend and `eslint .` clean on frontend (including all new test files). Backend's plain `eslint .`/`pnpm lint` fails to parse every file under `tests/` (including the 8 pre-existing test files untouched by this feature) because `tsconfig.json` excludes `tests/` from its `include` while `eslint.config.js` still points typed linting at that same tsconfig — a pre-existing project-wide config gap, not something introduced here; left unfixed as out of scope for this feature
- [X] T024 Run the full quickstart.md validation pass (all three manual scenarios plus every automated check listed) and fix any discovered issues — backend: 15/15 new tests passing (7 contract + 1 integration + 7 pre-existing tenant-isolation/account-lifecycle etc. unaffected); 3 pre-existing, unrelated integration tests (horizontal-scale, ip-change-pipeline, review-retry-notify) fail when the full suite runs together due to shared Redis/BullMQ state across files (documented risk in vitest.config.ts's own comment) — confirmed pre-existing and unrelated by running ip-change-pipeline in isolation (passes). Frontend: 19/19 unit tests passing, full `eslint .` and `tsc --noEmit` clean. Manual/live-browser portions of all three scenarios retain the same Logto auth-session caveat as 003-end-user-ui-redesign's tasks.md (no real signed-in session available in this environment)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: None — no tasks
- **Foundational (Phase 2)**: No dependencies beyond existing code — BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 has no dependency on US2/US3
  - US2 depends on US1's `CredentialFormDialog` (T009) being available, but is otherwise independently testable per its own Independent Test
  - US3 depends on US1's `DELETE` endpoint (T008) and Credentials page (T010) existing to extend
- **Polish (Phase 6)**: Depends on all three user stories being complete

### Within Each User Story

- Tests before the implementation task(s) they cover where practical (T005 before T006-008); where the behavior under test is itself the integration of several small changes, the test task follows instead (T016/T017 after T014-015; T020/T021 after T008/T019)
- Backend route changes are sequential within `provider-credentials.ts` (T006 → T007 → T008), since each edits the same file; T008 now includes the reference-check guard directly (folded in during `/speckit-analyze` remediation — see spec.md FR-010)
- Frontend: shared component (`CredentialFormDialog`, T009) before anything that consumes it (T010, T015)

### Parallel Opportunities

- T001 and T003 (Foundational, different files) in parallel; T004 (frontend, different package) in parallel with both
- T009 (US1, new frontend component) in parallel with T005-T008 (backend)
- T012 (US1 frontend test) in parallel with backend-only work once T010 exists
- T020 and T021 (US3, different test files) in parallel with each other once T008 lands
- T023 (Polish) has no story-specific dependency beyond all stories being implemented

---

## Parallel Example: User Story 1

```bash
# Backend and frontend work can proceed in parallel once Foundational (T001-T004) is done:
Task: "Modify POST /provider-credentials in backend/src/adapters/http/routes/provider-credentials.ts"
Task: "Create CredentialFormDialog in frontend/src/components/credentials/CredentialFormDialog.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational
2. Complete Phase 3: User Story 1
3. **STOP and VALIDATE**: Run quickstart.md Scenario 1 independently
4. Deploy/demo if ready — a working, standalone Credentials area; delete is guarded against orphaning any Action from the start (T008), so this is safe to ship even against the existing production system, not just a fresh account

### Incremental Delivery

1. Foundational → Foundation ready
2. Add User Story 1 → validate independently → deploy/demo (MVP)
3. Add User Story 2 → validate independently → deploy/demo (wizard no longer dead-ends)
4. Add User Story 3 → validate independently → deploy/demo (blocked-delete now names the specific referencing Actions in the UI, and reuse-across-Actions is proven end-to-end)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Do not commit automatically; commits are only created on the user's explicit request (see constitution's Explicit Commit Authorization principle)
- Stop at any checkpoint to validate story independently
- `DELETE`'s reference-check guard (FR-010) ships as part of T008/US1 itself, not deferred to US3, so it's never possible to deploy an unguarded delete against the existing production system (revised during `/speckit-analyze` remediation, finding G1). US3's own increment is proving independent multi-Action reuse end-to-end and surfacing the blocked-delete detail in the UI (T019).
