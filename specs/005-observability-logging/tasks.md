---

description: "Task list for Operational Logging & Traceability (Anwendungs- und Zugriffsprotokoll)"
---

# Tasks: Operational Logging & Traceability (Anwendungs- und Zugriffsprotokoll)

**Input**: Design documents from `/specs/005-observability-logging/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Included — plan.md and quickstart.md already commit to specific unit and integration test files as part of the design (mirroring 004-credential-management's approach), so the test tasks below are real deliverables, not optional extras.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root, per plan.md's Project Structure

## Path Conventions

Backend-only feature per plan.md: `backend/src/`, `backend/tests/`. No `frontend/` change. This feature adds one new module (`backend/src/observability/`) and makes small, targeted edits to files that already exist from 001-ip-change-automation — no new HTTP endpoint, no new aggregate.

**Note on test file layout**: plan.md sketches a single `tests/unit/observability/logging.test.ts`; this task list splits it into `correlation.test.ts` (US1) and `separation.test.ts` (US3) so each user story's test maps to exactly the concern that story delivers, without weakening independent testability.

---

## Phase 1: Setup

- [X] T001 Add `@logtape/logtape`, `@logtape/file`, `@logtape/hono`, and `@logtape/redaction` as runtime dependencies, and `@logtape/testing` as a dev dependency, to backend/package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared logging plumbing every user story depends on — the single LogTape `configure()` call, both category/sink trees, and the correlation-context helper

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add `appLogLevel`, `accessLogFilePath`, `accessLogMaxSizeBytes`, `accessLogMaxFiles` to the `Config` interface and `loadConfig()` (all optional, per contracts/config-env-vars.md's defaults) in backend/src/config/env.ts
- [X] T003 Create `configureLogging()`/`disposeLogging()` in backend/src/observability/logging.ts: `configure()` with `contextLocalStorage: new AsyncLocalStorage()`, two disjoint category/sink bindings per contracts/logging-topology.md (`["fluxip","app"]` → `getConsoleSink()`, `["fluxip","access"]` → `getRotatingFileSink(config.accessLogFilePath, { maxSize: config.accessLogMaxSizeBytes, maxFiles: config.accessLogMaxFiles })`), both sinks wrapped with `redactByField(sink, [...DEFAULT_REDACT_FIELDS, /authorization/i, /credential/i])` (depends on T002)
- [X] T004 [P] Create `getAppLogger(category)` and `withOperation(correlationId, fn)` in backend/src/observability/app-logger.ts, per contracts/logging-topology.md's API (depends on T003)
- [X] T005 Call `configureLogging()` at the top of `main()`, and `disposeLogging()` inside the existing `shutdown()` handler, in backend/src/main.ts (depends on T003)
- [X] T006 [P] Add a named volume for the Access Log directory to the `app` service in docker-compose.yml (that service currently has no volumes at all)
- [X] T007 [P] Document the four new environment variables (with defaults) in .env.example

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Trace a Single Operation End to End (Priority: P1) 🎯 MVP

**Goal**: Every Application Log entry produced by one trigger-driven operation (trigger report → confirmed IP change → each Action execution → outcome) carries the same correlation identifier, and a manual re-run gets its own.

**Independent Test**: Run quickstart.md Scenario 1 — trigger an IP change that fans out to multiple Actions (including a failure), then confirm every log entry belonging to that one trigger can be identified as part of the same operation via a shared correlation id, and read back as a coherent sequence.

### Implementation for User Story 1

- [X] T008 [P] [US1] Log a "trigger report received" entry (no correlation id — research.md §3) after `ip_client.ip_report_received` is appended; wrap the route handler body in a try/catch that logs an "error processing trigger report" entry via `getAppLogger(["trigger"])` on any thrown error before re-throwing (FR-003), in backend/src/adapters/http/routes/trigger.ts (depends on T004)
- [X] T009 [P] [US1] Wrap the `ip_client.ip_changed` append and the `fanOutActionExecutions` call in `withOperation(causationEvent.id, ...)`; log an "IP change confirmed" entry using `getAppLogger(["debounce"])`; wrap the job handler body in a try/catch that logs an "error processing debounce settlement" entry via `getAppLogger(["debounce"])` on any thrown error before re-throwing so BullMQ's own retry still applies (FR-003), in backend/src/adapters/queue-bullmq/debounce-worker.ts (depends on T004)
- [X] T010 [P] [US1] Log an "execution enqueued" entry per Action using `getAppLogger(["execution-fanout"])` (no new `withOperation` wrapping needed — runs inside the caller's already-established context per research.md §4), in backend/src/adapters/queue-bullmq/execution-fanout-worker.ts (depends on T004)
- [X] T011 [P] [US1] Wrap the job handler body in `withOperation(job.data.causationEventId, ...)`; log "execution started"/"execution succeeded"/"execution failed" entries using `getAppLogger(["action-execution"])` (including the failure `error` detail, FR-005); replace the existing raw `console.error` in `maybeSendNotification`'s catch block with a proper Application Log error entry, in backend/src/adapters/queue-bullmq/action-execution-worker.ts (depends on T004)
- [X] T012 [P] [US1] Wrap the manual-run job enqueue in `withOperation(jobData.causationEventId, ...)` and log a "manual execution requested" entry using `getAppLogger(["action-run"])`, in backend/src/adapters/http/routes/action-run.ts (depends on T004)

### Tests for User Story 1

- [X] T013 [P] [US1] Unit test (using `@logtape/testing`'s `createLogRecorder()`): `withOperation`/`getAppLogger` correlation propagation across nested calls, and that a manual re-run's correlation id differs from an automatic operation's, in backend/tests/unit/observability/correlation.test.ts (depends on T008-T012)
- [X] T014 [US1] Integration test (real Postgres+Redis, this repo's existing pattern): run the trigger → debounce → fan-out → execution pipeline end to end and assert every Application Log entry for one operation shares one correlation id (SC-001), and a manual re-run of a failed Action produces entries under a distinct correlation id rooted at its own request, in backend/tests/integration/operation-traceability.test.ts (depends on T008-T012)

### Validation for User Story 1

- [X] T015 [US1] Run quickstart.md Scenario 1 and confirm outcomes

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP slice.

---

## Phase 4: User Story 2 - Review Incoming HTTP Traffic via a Separate Access Log (Priority: P2)

**Goal**: Every incoming HTTP request — successful, failed, or rejected before authentication — produces an Access Log entry in the rotating file, independent of the Application Log.

**Independent Test**: Run quickstart.md Scenario 2 — send a mix of valid, invalid, authenticated, and unauthenticated requests to the backend and confirm every one produces a corresponding Access Log entry, retrievable independently of the Application Log.

### Implementation for User Story 2

- [X] T016 [US2] Create `resolveSourceIp(c)` (connection remote address via the same `getConnInfo` helper `trigger.ts` uses, falling back to `X-Forwarded-For`) and a `honoLogger` config factory in backend/src/observability/access-log.ts (depends on T003)
- [X] T017 [US2] Mount `honoLogger({ category: ["fluxip","access"], context: true, format: "structured-combined", enrich: (c) => ({ sourceIp: resolveSourceIp(c) }) })` at the very top of `app` — before the trigger route, `api`, and `admin` sub-routers — in backend/src/adapters/http/app.ts (depends on T016)

### Tests for User Story 2

- [X] T018 [P] [US2] Unit test: an Access Log entry includes method/path/status/`sourceIp`; a request rejected before authentication (e.g. bad Trigger Device credential) still produces an Access Log entry with no corresponding Application Log entry (FR-007), in backend/tests/unit/observability/access-log.test.ts (depends on T017)

### Validation for User Story 2

- [X] T019 [US2] Run quickstart.md Scenario 2 and confirm outcomes

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Trust That the Two Logs Never Mix (Priority: P3)

**Goal**: Confirm, with tests (not just code review), that the Application Log and Access Log are structurally disjoint — no entry crosses streams, secrets never appear in either, and one stream's destination failing doesn't affect the other or block business logic.

**Independent Test**: Run quickstart.md Scenario 3 — generate both Application Log and Access Log activity simultaneously (including a request rejected before authentication) and confirm each output stream contains only its own kind of entries, with neither depending on the other to function.

### Tests for User Story 3

- [X] T020 [P] [US3] Unit test: the `["fluxip","app"]` and `["fluxip","access"]` category trees route to disjoint sinks with no overlap; `redactByField` prevents a deliberately-included secret-shaped property (e.g. `{ token: "..." }`) from appearing in a recorded entry on either sink, in backend/tests/unit/observability/separation.test.ts (depends on T003, T017)
- [X] T021 [US3] Extend the Phase 3 integration test with: zero Access Log entries appear in Application Log output and vice versa (SC-003) across simultaneous activity; zero plaintext secret values appear in either stream when a Provider Credential is created and used during the same run (SC-004), in backend/tests/integration/operation-traceability.test.ts (depends on T014, T017)
- [X] T022 [P] [US3] Unit test: `disposeLogging()` disposes both sinks (asserted via a spy/mock `Disposable`, not real file I/O), so a graceful shutdown flushes buffered Access Log writes rather than dropping them (research.md §8), in backend/tests/unit/observability/logging-shutdown.test.ts (depends on T003)
- [X] T023 [P] [US3] Unit test: simulate a sink write failure (e.g. a mocked sink that throws/rejects) and assert the triggering HTTP request still completes successfully and an Action execution still completes/records its outcome (FR-010/SC-006), in backend/tests/unit/observability/failure-isolation.test.ts (depends on T003)

### Validation for User Story 3

- [X] T024 [US3] Run quickstart.md Scenario 3 and confirm outcomes

**Checkpoint**: All three user stories are independently functional; the full feature is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T025 [P] Type-check and lint the backend (`tsc --noEmit`, `eslint src`) and fix any issues surfaced by the changes above
- [X] T026 Re-run 001-ip-change-automation's existing `tests/integration/trigger-performance.test.ts` and confirm the <200ms p95 target still holds with logging enabled (SC-007/FR-011) — do not weaken or delete that test; if it now fails, address the logging call path's overhead, not the test
- [X] T027 Run the full quickstart.md validation pass (all three manual scenarios plus every automated check listed) and fix any discovered issues

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001) — BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 has no dependency on US2/US3
  - US2 depends on Foundational's `configureLogging()` (T003) only — independently testable per its own Independent Test, even before any US1 call site logs anything
  - US3 depends on US1's integration test (T014, extended by T021) and US2's `honoLogger` mount (T017) existing to validate against
- **Polish (Phase 6)**: Depends on all three user stories being complete (T025-T027)

### Within Each User Story

- Implementation tasks (T008-T012) before the tests that exercise their combined behavior (T013-T014), matching 004-credential-management's precedent for tests that validate an integration of several small changes
- T016 before T017 (the mount depends on the factory existing) within US2
- Backend files are otherwise independent per task — five different files touched in US1's implementation (T008-T012), so all five run in parallel

### Parallel Opportunities

- T002, T006, T007 (Foundational, different files) in parallel; T004 depends on T003 so is not parallel with it
- T008, T009, T010, T011, T012 (US1 implementation, five different files) fully in parallel once T004 lands
- T013 (US1 unit test) and T018 (US2 unit test) in parallel with each other once their respective implementations land
- T020, T022, and T023 (US3, different test files) in parallel with each other
- T025 (Polish) has no story-specific dependency beyond all stories being implemented

---

## Parallel Example: User Story 1

```bash
# All five implementation tasks touch different files and can run together once Foundational (T001-T007) is done:
Task: "Log 'trigger report received' in backend/src/adapters/http/routes/trigger.ts"
Task: "Wrap ip_changed append + fan-out in withOperation(...) in backend/src/adapters/queue-bullmq/debounce-worker.ts"
Task: "Log 'execution enqueued' per Action in backend/src/adapters/queue-bullmq/execution-fanout-worker.ts"
Task: "Wrap job handler in withOperation(...) in backend/src/adapters/queue-bullmq/action-execution-worker.ts"
Task: "Wrap manual-run enqueue in withOperation(...) in backend/src/adapters/http/routes/action-run.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run quickstart.md Scenario 1 independently
5. Deploy/demo if ready — operators can already trace one operation end to end via stdout; the Access Log doesn't exist yet, but nothing about US1 depends on it

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → validate independently → deploy/demo (MVP — operation tracing works)
3. Add User Story 2 → validate independently → deploy/demo (Access Log now populated)
4. Add User Story 3 → validate independently → deploy/demo (separation and redaction proven by tests, not just design)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Do not commit automatically; commits are only created on the user's explicit request (see constitution's Explicit Commit Authorization principle)
- Stop at any checkpoint to validate story independently
- The correlation identifier is never a new field — every US1 task reads a `causationEventId` value the codebase already computes (research.md §3); no 001-ip-change-automation data-model change is part of this task list
