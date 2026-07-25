# Implementation Plan: Operational Logging & Traceability (Anwendungs- und Zugriffsprotokoll)

**Branch**: `005-observability-logging` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-observability-logging/spec.md`

## Summary

Adds structured operational logging to the existing backend using **LogTape**, configured as two fully disjoint category trees so the Application Log (console/stdout, matching Docker's log-driver model) and the Access Log (a rotating file, via `@logtape/hono`'s request-logging middleware) can never mix (FR-008). Every Application Log entry produced by a trigger-driven operation carries the *existing* `causationEventId` value already threaded through the codebase (the confirmed `ip_client.ip_changed` event's own ID for automatic executions, or the manual request's own ID for manual re-runs) as its correlation identifier — no new identifier scheme, no event-sourcing data-model change. Secret values are kept out of both streams via `@logtape/redaction`'s field-based redaction, layered on top of call sites that never log secrets directly. This is a backend-only change; no frontend, no new HTTP endpoints, no new persisted aggregate.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS (backend only — this feature has no frontend surface).

**Primary Dependencies**: `@logtape/logtape` (core; user-specified), `@logtape/file` (rotating file sink for the Access Log), `@logtape/hono` (Hono middleware providing both the Access Log's request logging and request-scoped correlation-context propagation), `@logtape/redaction` (field-based secret redaction wrapping both sinks), `@logtape/testing` (dev-only; in-memory log recorder for assertions). Existing Hono, BullMQ, `pg`, `ulid` are unchanged and unaffected.

**Storage**: No new persistent store or aggregate. The Access Log writes to a rotating file on a new Docker volume (so it survives container restarts); the Application Log writes to stdout only, relying on the container runtime's own log-driver capture/retention.

**Testing**: Vitest, using `@logtape/testing`'s `createLogRecorder()` as a substitute sink in place of the real console/file sinks, so assertions read structured records directly instead of parsing stdout or a file. One new integration test exercises the real trigger → debounce → fan-out → execution pipeline (reusing this repo's existing real-Postgres+Redis test pattern) to prove correlation reconstruction (SC-001) and stream separation (SC-003) against actual production code paths, not just the logging module in isolation.

**Target Platform**: Unchanged — Docker/Linux server.

**Project Type**: Backend-only addition to the existing `backend/` + `frontend/` pnpm workspace; `frontend/` is untouched.

**Performance Goals**: FR-011/SC-007 — logging MUST NOT push the trigger-ingestion endpoint's existing <200ms p95 target (001-ip-change-automation SC-002) above that threshold. Achieved structurally: the console sink is inherently non-blocking (stdout write), and the rotating file sink is configured with `nonBlocking: true` plus its default buffering (8192-char buffer, 5s flush interval), so no log write ever synchronously blocks request handling (consistent with FR-010's failure-isolation guarantee).

**Constraints**: App Log and Access Log MUST be two structurally disjoint LogTape category trees with disjoint sinks (FR-008) — enforced by construction, not convention, even though LogTape's `configure()` is necessarily one process-wide call. The correlation identifier MUST be the already-existing `causationEventId` value (no new field, no aggregate change). Secret values (Provider Credential tokens, Trigger Device reporting credentials, Authorization headers) MUST never reach either stream (FR-009), enforced by both careful call sites and sink-level redaction.

**Scale/Scope**: Same as 001-ip-change-automation — logging must keep working correctly (no dropped correlation, no regressed latency) at the ≥1,000-concurrent-report scale already required by that spec's SC-004.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` defines a single ratified principle: **Explicit Commit Authorization** (commits only on explicit user request, Conventional Commits derived from the diff and prior history). It is a process rule for the assistant, not a design constraint, and does not gate any technical decision in this plan. No other principles are defined. No violations.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/` describe log record shapes and the LogTape category/sink topology — no new aggregate, no new HTTP endpoint, no new frontend surface. Still no formal gates to violate; nothing to record in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/005-observability-logging/
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
│   ├── observability/
│   │   ├── logging.ts                          # NEW — configureLogging()/disposeLogging(): declares both disjoint category trees + sinks (console for app, redacted rotating file for access), wraps both sinks with @logtape/redaction
│   │   └── app-logger.ts                        # NEW — getAppLogger(category) + withOperation(correlationId, fn) thin wrapper over LogTape's getLogger/withContext, used by every app-log call site
│   ├── main.ts                                  # MODIFIED — calls configureLogging() first; disposeLogging() added to the existing SIGTERM/SIGINT shutdown handler
│   ├── config/env.ts                            # MODIFIED — new env vars: BACKEND_ACCESS_LOG_FILE_PATH, BACKEND_ACCESS_LOG_MAX_SIZE_BYTES, BACKEND_ACCESS_LOG_MAX_FILES, BACKEND_APP_LOG_LEVEL
│   ├── adapters/http/app.ts                     # MODIFIED — mounts @logtape/hono's honoLogger() (Access Log + request-context) at the very top of `app`, before every route including the trigger endpoint (FR-007)
│   ├── adapters/http/routes/trigger.ts          # MODIFIED — logs a "trigger report received" Application Log entry after appending ip_report_received (FR-001)
│   ├── adapters/queue-bullmq/debounce-worker.ts # MODIFIED — establishes the operation's correlation context via withOperation(causationEvent.id, ...) and logs "IP change confirmed" around the ip_changed append + fan-out
│   ├── adapters/queue-bullmq/execution-fanout-worker.ts # MODIFIED — logs "execution enqueued" per Action inside the caller's already-established correlation context
│   └── adapters/queue-bullmq/action-execution-worker.ts # MODIFIED — re-establishes withOperation(causationEventId, ...) at the start of the job handler (a queued job is a fresh async context — the enqueuing request's implicit context does not survive the queue boundary), logs started/succeeded/failed (FR-002/FR-005), and replaces the existing raw `console.error` notification-failure line with a proper Application Log error entry (FR-003)
└── tests/
    ├── unit/observability/logging.test.ts              # NEW — category/sink separation, redaction, withOperation correlation propagation
    └── integration/operation-traceability.test.ts       # NEW — real trigger→debounce→fan-out→execution flow: every entry shares one correlation ID (SC-001), Access Log entries are independent (SC-002/SC-003), no plaintext secrets appear (SC-004), a manual re-run gets its own correlation root

docker-compose.yml                               # MODIFIED — new named volume for the app service's Access Log directory, so the rotating file persists across container restarts
.env.example                                     # MODIFIED — documents the four new env vars
```

**Structure Decision**: No new package or top-level project. All backend changes are additive within the existing `backend/src/` tree (one new `observability/` module) plus small, targeted edits to the exact points that already exist for trigger handling, debounce settlement, and Action execution — the correlation ID these log calls use is a value the codebase already computes and passes around (`causationEventId`), so no other file needs to change. `frontend/` is entirely untouched, and no new HTTP route is added (the honoLogger middleware wraps existing routes; it doesn't add one).

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
