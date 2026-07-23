# Phase 0 Research: Operational Logging & Traceability

No `[NEEDS CLARIFICATION]` markers remained in `spec.md` after the `/speckit-clarify` session. This phase focuses on how to satisfy the user-specified library (LogTape) and the spec's requirements using the codebase's existing structure — in particular, reconciling the correlation-ID requirement with the `causationEventId` value already threaded through 001-ip-change-automation's code.

## 1. Package selection: LogTape + its official companion packages

**Decision**: Use `@logtape/logtape` (core) plus four official companion packages: `@logtape/file` (rotating file sink), `@logtape/hono` (HTTP request-logging middleware + request-context propagation), `@logtape/redaction` (field-based secret redaction), and `@logtape/testing` (dev-only log recorder for tests).

**Rationale**: The logging library itself was specified by the user (not a planning decision). Its official companion packages directly map onto this spec's requirements with no custom code needed for the hard parts: `@logtape/hono`'s `honoLogger()` middleware *is* an Access Log (method, path, status, response time, content-length, user-agent, referrer) and *is* the mechanism for propagating a request-scoped correlation id; `@logtape/file`'s `getRotatingFileSink()` *is* the "separate file that can be rotated" the user asked for; `@logtape/redaction`'s `redactByField()` *is* the secret-redaction safety net FR-009 requires.

**Alternatives considered**: Hand-rolling an Express/Hono `morgan`-style access-log middleware and a manual `fs`-based rotating writer — rejected; `@logtape/hono` and `@logtape/file` already do exactly this, are maintained by the same project as the core library the user chose, and avoid reinventing rotation-file-naming and buffered-write logic.

## 2. Two disjoint category trees enforce stream separation (FR-008)

**Decision**: All Application Log calls use categories under `["fluxip", "app", ...]` (e.g. `["fluxip", "app", "trigger"]`, `["fluxip", "app", "action-execution"]`), routed only to the console sink. The Access Log uses exactly one category, `["fluxip", "access"]`, used solely by `honoLogger({ category: ["fluxip", "access"], ... })`, routed only to the redacted rotating-file sink. Both trees are declared in one `configure()` call (LogTape has no multi-instance concept — this is unavoidable, not a design choice), but no sink is ever shared between the two trees and no code path logs Access Log content through an app-category logger or vice versa.

**Rationale**: This is LogTape's own documented mechanism for exactly this use case (per-category sink routing). "Two separate output streams, no shared logger/config that could mix entries" (per spec's non-negotiable requirement) is satisfied at the sink-assignment level: even though one `configure()` call declares both, nothing about that call lets one category's records reach the other's destination.

**Alternatives considered**: Two entirely separate Node processes (one only ever calling app-log functions, one only ever running the HTTP server) — rejected as wildly disproportionate; the category/sink mechanism gives the same hard guarantee without doubling the deployment topology.

## 3. Correlation identifier = the existing `causationEventId`, not a new field

**Decision**: The Application Log's correlation identifier is the `causationEventId` value the codebase already computes and passes through `ActionExecutionJobData` at every relevant point:
- `debounce-worker.ts` generates it as `causationEvent.id` (the `ip_client.ip_changed` event's own CloudEvents `id`, from `buildDomainEvent`) the moment a debounced report settles into a confirmed change, and passes it into `fanOutActionExecutions(...)`.
- `action-run.ts` (manual re-run) already generates a fresh `causationEventId: ulid()` at request time, independent of any original trigger event.

No new field, no change to any event payload, no change to `data-model.md` in 001-ip-change-automation.

**Rationale**: This is exactly what the resolved spec clarification asked for ("matching the core specification's existing `causationEventId` distinction... exactly, so this feature requires no change to that existing model").

**Consequence — resolving an apparent tension between two parts of the spec**: `spec.md`'s User Story 1 / FR-001 talks about logging "whenever a Trigger Device's IP-change report is accepted" — which, read literally, is the raw `ip_client.ip_report_received` event, appended in `trigger.ts` on *every* inbound report, including ones later superseded by flapping and debounced away without ever producing an `ip_client.ip_changed`. But `causationEventId` (the correlation root FR-004 requires) doesn't exist until debounce settles — a raw report can't carry an ID that hasn't been generated yet. This plan resolves the tension as follows: both are logged, but only one anchors a traceable *operation*:
  - Every raw `ip_report_received` gets its own Application Log entry (audit trail: "device X reported IP Y at time T"), tagged with `tenantId`/`ipClientId` only — not yet part of any correlation chain, since it may never become one.
  - The `ip_client.ip_changed` confirmation — the actual "trigger event" User Story 1 traces from — is logged with `causationEventId` (=its own new ID) as the correlation root, and that same value is what every subsequent Action-execution log entry carries.

  This means User Story 1's "an Application Log entry records that the trigger event was received, tied to an identifier that also appears on every log entry produced because of it" (AC1) is satisfied by the `ip_changed` confirmation log line, not the earlier raw-report line — consistent with the spec's own framing ("IP-Änderung von Gerät X hat zu DNS-Update Y geführt": an IP *change*, not every raw ping, is what leads to an action).

**Alternatives considered**: Generating a fresh correlation ID at raw-report time and threading it through the `ip_client` aggregate into the eventual `ip_changed`/executions — rejected: it would require adding a new field to `ip_client.ip_report_received` and `ip_client.ip_changed` (a 001 data-model change the clarification explicitly said to avoid), and provides no benefit for reports that never settle into a change (nothing would ever join to that ID anyway).

## 4. Implicit context via `AsyncLocalStorage`, explicitly re-established across the BullMQ queue boundary

**Decision**: `configure()` is called with `contextLocalStorage: new AsyncLocalStorage()`, enabling LogTape's implicit-context propagation (`withContext()`) within one in-process async call chain (e.g., inside one HTTP request, or inside one BullMQ job's handler). A small helper, `withOperation(correlationId, fn)` (`observability/app-logger.ts`), wraps `withContext({ correlationId }, fn)` and is called explicitly at the start of: the debounce-worker's settle handler (once `causationEvent.id` exists), and the action-execution-worker's job handler (from `job.data.causationEventId`).

**Rationale**: A BullMQ job handler runs in a fresh async context when the worker's event loop picks it up — it is *not* a continuation of the HTTP request or the debounce-worker call that enqueued it, even within the same Node process. Implicit context does not, and cannot, survive that boundary automatically; the correlation ID must travel as ordinary job data (which it already does, as `causationEventId`) and be explicitly re-applied via `withOperation(...)` at the start of each downstream async context.

**Alternatives considered**: Manually passing a logger/context object as a function parameter through every call chain instead of `AsyncLocalStorage` — rejected; noisier at every call site, and LogTape's implicit-context mechanism already does this cleanly for the in-process portions (e.g., inside `fanOutActionExecutions`, which runs synchronously within the debounce-worker's already-established context and needs no extra plumbing itself).

## 5. Secret redaction: defense-in-depth, not the only safeguard

**Decision**: Call sites are written to never pass a secret value (a Provider Credential's decrypted token, a Trigger Device's reporting credential, an `Authorization` header) as a log message argument or structured property. In addition, both sinks are wrapped with `@logtape/redaction`'s `redactByField()`, configured with `DEFAULT_REDACT_FIELDS` (covers `password`/`secret`/`token`) plus two additions: `/authorization/i` and `/credential/i`.

**Rationale**: FR-009/SC-004 is a hard "MUST NEVER" requirement. Relying solely on disciplined call sites is fragile against a future change accidentally logging a full object that happens to contain a secret field; sink-level redaction is a cheap, structural second layer that doesn't depend on every future contributor remembering the rule.

**Alternatives considered**: Pattern-based redaction (`redactByPattern`, regex over rendered text) as the only layer — rejected as the sole mechanism (it only catches secrets matching a known shape, e.g. JWTs), but not rejected outright: field-based redaction is the primary layer because our secrets are always logged (if at all, by mistake) as named structured properties, not free text.

## 6. Access Log rotation: size-based (not daily), and where it's stored

**Decision**: The Access Log is written via `@logtape/file`'s `getRotatingFileSink(path, { maxSize, maxFiles })` — size-based rotation with numbered suffixes (`.1`, `.2`, ...). The Application Log is written via `getConsoleSink()` to stdout only, with no file and no rotation — Docker's own log driver owns its capture and retention, matching standard container logging practice.

**Rationale**: The feature description explicitly offered "e.g. daily rotation or size-based" as acceptable alternatives; `@logtape/file` only implements size-based rotation (no daily/time-based mode), which is within the explicitly offered scope.

**Consequence**: `docker-compose.yml`'s `app` service needs a new named volume mounted at the Access Log's directory so the rotating file (and its rotated siblings) survive container restarts — today that service has no volumes at all, so a file written inside the container would otherwise be lost on every recreation.

## 7. Access Log's source-IP field requires an explicit `enrich` callback

**Decision**: `honoLogger`'s default structured format (`method`, `url`, `path`, `status`, `responseTime`, `contentLength`, `userAgent`, `referrer`) does not include a source-IP field — Hono doesn't expose socket-level info consistently across runtimes. The Access Log configuration adds `enrich: (c) => ({ sourceIp: ... })`, reading the connection's remote address the same way `trigger.ts` already does (`@hono/node-server/conninfo`'s `getConnInfo(c)`), falling back to the `X-Forwarded-For` header for reverse-proxied deployments.

**Rationale**: Satisfies FR-006's requirement (resolved by clarification) that each Access Log entry include the caller's source IP address.

**Alternatives considered**: Using one of the Morgan-compatible text formats (`morgan-combined`), which does include a remote-address field via `X-Forwarded-For` — rejected as the primary format because it produces text, not structured records, making SC-003's "zero cross-contamination" and future querying harder to verify/automate than the structured format plus one added field.

## 8. Graceful shutdown flushes both sinks

**Decision**: `main.ts`'s existing SIGTERM/SIGINT `shutdown()` handler additionally calls `disposeLogging()` (which disposes both `Sink & Disposable` sinks) before the process exits.

**Rationale**: The rotating file sink buffers writes (default `bufferSize: 8192`, `flushInterval: 5000ms`); a clean shutdown can happen well within that window, and a graceful exit should never silently drop already-written Access Log lines still sitting in the buffer. This is distinct from FR-010 (a *failure* to write must not block business logic) — this is about not losing already-accepted log data on an orderly shutdown.

## 9. Testing approach: `@logtape/testing`'s log recorder, plus one real pipeline test

**Decision**: Unit tests substitute `createLogRecorder()` as the sink for both category trees and assert on structured `LogRecord`s directly (category, correlation-id property, message). One integration test runs the actual trigger → debounce → fan-out → execution pipeline (same real-Postgres+Redis pattern already used by this repo's other integration tests) and asserts, from the real emitted records, that: every entry for one operation shares one correlation id (SC-001), a manual re-run's entries share a *different* id rooted at its own request (per the resolved clarification), and no entry in either stream contains a plaintext secret (SC-004).

**Rationale**: The recorder gives fast, precise unit-level assertions without parsing stdout/files; the one real pipeline test guards against the recorder-based unit tests passing while the actual wiring (e.g., a forgotten `withOperation(...)` call around a real BullMQ worker) is broken.
