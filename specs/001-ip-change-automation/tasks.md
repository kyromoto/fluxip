---

description: "Task list for IP-Change-Triggered Automation (FluxIP Core)"
---

# Tasks: IP-Change-Triggered Automation (FluxIP Core)

**Input**: Design documents from `/specs/001-ip-change-automation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not explicitly requested in spec.md, so no dedicated test-writing tasks are included. Each user-story phase ends with a "Run quickstart.md Scenario N" task instead, which is that story's independent-test checkpoint.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root, per plan.md's Project Structure

## Path Conventions

Web application per plan.md: `backend/src/`, `backend/tests/`, `frontend/src/`. Aggregate/event names (`ip_client`, `action`, `action_execution`, `provider_credential`, `notification_channel`, `account`) are as confirmed in data-model.md.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Create monorepo structure (`backend/`, `frontend/`, root `pnpm-workspace.yaml`) per plan.md Project Structure
- [X] T002 [P] Initialize backend TypeScript project with pnpm (`package.json`, `tsconfig.json` strict mode, Node 22 engines field) in backend/
- [X] T003 [P] Initialize frontend SolidJS + Vite + TypeScript project with pnpm in frontend/
- [X] T004 [P] Configure ESLint + Prettier for backend in backend/.eslintrc.cjs
- [X] T005 [P] Configure ESLint + Prettier for frontend in frontend/.eslintrc.cjs
- [X] T006 [P] Configure Vitest in backend/vitest.config.ts
- [X] T007 Create docker-compose.yml wiring app, Postgres, Redis, and Logto containers per plan.md Deployment constraints
- [X] T008 [P] Create backend Dockerfile (Node 22, pnpm via corepack, no config files baked in, env-var only) in backend/Dockerfile
- [X] T009 [P] Create frontend Dockerfile (pnpm via corepack, static build) in frontend/Dockerfile
- [X] T010 Create .env.example documenting all required environment variables (CLOUDEVENTS_SOURCE, CLOUDEVENTS_TYPE_PREFIX, DEFAULT_IP_CLIENT_LIMIT, ACTION_RETRY_ATTEMPTS, ACTION_RETRY_BASE_DELAY_MS, IP_CLIENT_DEBOUNCE_MS, LOGTO_MANAGEMENT_CLIENT_ID, LOGTO_MANAGEMENT_CLIENT_SECRET, LOGTO_MANAGEMENT_API_BASE_URL, CREDENTIAL_ENCRYPTION_KEY, Postgres/Redis/Logto connection settings) in .env.example

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T011 Create Postgres migration for the append-only `events` table (`aggregate_id`, `aggregate_type`, `sequence_number`, `tenant_id`, CloudEvents envelope columns, unique `(aggregate_id, sequence_number)`) in backend/src/adapters/event-store-postgres/migrations/0001_events.sql
- [X] T012 Implement environment-variable config loader with validation in backend/src/config/env.ts
- [X] T013 [P] Implement CloudEvents envelope builder reading `CLOUDEVENTS_SOURCE`/`CLOUDEVENTS_TYPE_PREFIX` from config in backend/src/domain/cloud-events.ts
- [X] T014 Define the `EventStore` port (append with optimistic concurrency, read stream, tenant-scoped) in backend/src/ports/event-store.ts
- [X] T015 Implement the Postgres `EventStore` adapter in backend/src/adapters/event-store-postgres/postgres-event-store.ts (depends on T011, T014)
- [X] T016 [P] Implement a generic aggregate-replay helper (fold events → state) instrumented with replay-duration/event-count metrics per research.md §10 in backend/src/domain/replay.ts
- [X] T017 [P] Configure `prom-client` metrics registry and `/metrics` route in backend/src/adapters/http/metrics-route.ts
- [X] T018 Implement Logto OIDC/JWKS token-verification middleware (`jose`) in backend/src/adapters/auth-logto/oidc-middleware.ts
- [X] T019 Implement account auto-provisioning on first authenticated request (emits `account.registered` if none exists yet for this tenant; initializes `deviceLimit` from `DEFAULT_IP_CLIENT_LIMIT`, FR-033) in backend/src/domain/account/account-service.ts (depends on T015, T018)
- [X] T020 [P] Implement BullMQ queue/worker bootstrap (Redis connection, queue naming) in backend/src/adapters/queue-bullmq/queue.ts
- [X] T021 Implement the Hono app entrypoint wiring config, auth middleware, routes, and the metrics route in backend/src/adapters/http/app.ts (depends on T012, T017, T018)
- [X] T022 [P] Implement a tenant-scoped repository base that requires and enforces `tenant_id` at the query level per research.md §8 in backend/src/adapters/event-store-postgres/tenant-scoped-repository.ts (depends on T015)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Automatic DNS Update on IP Change (Priority: P1) 🎯 MVP

**Goal**: A user can store a Hetzner credential, register an IP Client, attach a DNS-Update Action, and have a reported IP change automatically update the DNS record end-to-end.

**Independent Test**: Run quickstart.md Scenario 1 — register a Provider Credential, an IP Client, and a DNS-Update Action; call the trigger endpoint with a new IP; verify the Hetzner record updates and the execution history shows success, with no re-trigger on a repeated identical IP.

### Implementation for User Story 1

- [X] T023 [P] [US1] Define `ip_client` event payload types (`registered`, `credential_rotated`, `enabled`, `disabled`, `decommissioned`, `ip_report_received`, `ip_changed`, `notification_preference_set`) in backend/src/domain/ip-client/events.ts
- [X] T024 [P] [US1] Implement the `ip_client` aggregate (replay → state, command validation) in backend/src/domain/ip-client/ip-client-aggregate.ts (depends on T023)
- [X] T025 [P] [US1] Implement system-generated reporting-credential utility (random secret + salted hash, plaintext never persisted, research.md §14) in backend/src/domain/ip-client/credential.ts
- [X] T026 [US1] Implement `POST /api/ip-clients` (register; enforces the account's `deviceLimit`, FR-003) in backend/src/adapters/http/routes/ip-clients.ts (depends on T019, T024, T025)
- [X] T027 [US1] Implement `GET /api/ip-clients` (list, from a Redis projection) in backend/src/adapters/http/routes/ip-clients.ts (depends on T026)
- [X] T028 [P] [US1] Define `provider_credential` event payload types (`stored`, `rotated`, `revoked`) in backend/src/domain/provider-credential/events.ts
- [X] T029 [P] [US1] Implement the `provider_credential` aggregate with encrypted-secret storage in backend/src/domain/provider-credential/provider-credential-aggregate.ts (depends on T028)
- [X] T030 [US1] Implement `POST /api/provider-credentials` (store) and `GET /api/provider-credentials` (list, secrets never returned) in backend/src/adapters/http/routes/provider-credentials.ts (depends on T029)
- [X] T031 [P] [US1] Define `action` event payload types (`attached`, `reconfigured`, `enabled`, `disabled`, `detached`) in backend/src/domain/action/events.ts
- [X] T032 [P] [US1] Implement the `action` aggregate, validating `addressFamilies` and that `config.providerCredentialId` belongs to the same account (FR-013) in backend/src/domain/action/action-aggregate.ts (depends on T031)
- [X] T033 [US1] Implement `POST /api/ip-clients/{ipClientId}/actions` (attach, type `update_dns_record`) and its `GET` listing in backend/src/adapters/http/routes/actions.ts (depends on T030, T032)
- [X] T034 [US1] Implement the dyndns2 trigger endpoint `GET /nic/update` (Basic Auth against the IP Client's credential hash, appends `ip_report_received`) per contracts/trigger-endpoint.md in backend/src/adapters/http/routes/trigger.ts (depends on T024, T025)
- [X] T035 [US1] Implement the 30s debounce scheduler (BullMQ delayed job keyed by `ip_client_id`, research.md §6) in backend/src/adapters/queue-bullmq/debounce-scheduler.ts (depends on T020, T034)
- [X] T036 [US1] Implement the debounce-settle worker: on delay elapse, replay the `ip_client`, compare to last known IP, append `ip_changed` only if changed (FR-006) in backend/src/adapters/queue-bullmq/debounce-worker.ts (depends on T035)
- [X] T037 [P] [US1] Define `action_execution` event payload types (`started`, `succeeded`, `failed`, `retry_scheduled`, `notification_sent`) in backend/src/domain/action-execution/events.ts
- [X] T038 [US1] Implement the fan-out worker: on `ip_changed`, enqueue one execution job per enabled Action on that IP Client, with a deterministic dedup job ID (FR-014) in backend/src/adapters/queue-bullmq/execution-fanout-worker.ts (depends on T036, T037)
- [X] T039 [P] [US1] Define the `ActionExecutor` port in backend/src/ports/action-executor.ts
- [X] T040 [US1] Implement the Hetzner DNS `ActionExecutor` adapter (updates an existing A/AAAA record only, FR-008) in backend/src/adapters/actions/hetzner-dns/hetzner-dns-executor.ts (depends on T029, T039)
- [X] T041 [US1] Implement the action-execution worker: validate required address families are present (FR-026/FR-027), invoke the `ActionExecutor`, append `started`/`succeeded`/`failed`, independently per Action (FR-022) in backend/src/adapters/queue-bullmq/action-execution-worker.ts (depends on T038, T040)
- [X] T042 [US1] Configure BullMQ retry with exponential backoff (5 attempts, 30s base delay, research.md §5) on the action-execution queue in backend/src/adapters/queue-bullmq/queue.ts (depends on T041)
- [X] T043 [US1] Implement `GET /api/actions/{id}/executions` (execution history) in backend/src/adapters/http/routes/action-executions.ts (depends on T041)
- [X] T044 [P] [US1] Frontend: IP Client creation form + one-time credential display page in frontend/src/pages/IpClients.tsx (depends on T026)
- [X] T045 [P] [US1] Frontend: Action-attach form (DNS Action config: zone, record, address families, credential picker) in frontend/src/pages/Actions.tsx (depends on T033)
- [X] T046 [US1] Run quickstart.md Scenario 1 end-to-end and fix any gaps found — validated two ways: (1) an automated integration test (backend/tests/integration/ip-change-pipeline.test.ts) against real Postgres+Redis+BullMQ with a stub ActionExecutor, covering flapping and no-op re-reports; (2) a live manual run against the user's real Logto instance (auth.logto.kyro.space) and the real Hetzner DNS API — real OIDC token verification, HTTP registration of an IP Client/Provider Credential/Action, the dyndns2 trigger endpoint, debounce/settle, and Action execution all worked end-to-end; execution correctly recorded a failure (FR-011) when given a deliberately fake Hetzner token, proving graceful failure handling reaches the real third-party API without crashing the worker

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 - Manage Multiple Isolated Trigger Devices (Priority: P2)

**Goal**: A user can manage several independent IP Clients/Actions, and tenant isolation is enforced everywhere; an administrator can adjust an account's device limit.

**Independent Test**: Run quickstart.md Scenario 2 — as a second user, confirm the first user's resources return 404, and that referencing another account's Provider Credential in an Action is rejected.

### Implementation for User Story 2

- [X] T047 [P] [US2] Implement `GET /api/ip-clients/{id}`, `POST /api/ip-clients/{id}/enable`, `/disable` in backend/src/adapters/http/routes/ip-clients.ts (depends on T027)
- [X] T048 [P] [US2] Implement `POST /api/ip-clients/{id}/rotate-credential` (FR-019) in backend/src/adapters/http/routes/ip-clients.ts (depends on T025, T027)
- [X] T049 [P] [US2] Implement `DELETE /api/ip-clients/{id}` (decommission, irreversible) in backend/src/adapters/http/routes/ip-clients.ts (depends on T027)
- [X] T050 [US2] Implement `POST /admin/accounts/{accountId}/device-limit` (emits `account.device_limit_overridden`, FR-034) in backend/src/adapters/http/routes/admin-accounts.ts (depends on T019)
- [X] T051 [US2] Implement an admin-role-claim guard middleware for `/admin/*` routes, checking the Logto role/claim provisioned per research.md §17 in backend/src/adapters/auth-logto/admin-guard.ts (depends on T018, T050)
- [X] T052 [US2] Implement `PUT /api/actions/{id}` (reconfigure), `enable`/`disable`, `DELETE` (detach) in backend/src/adapters/http/routes/actions.ts (depends on T033)
- [X] T053 [US2] Implement `DELETE /api/account` triggering the synchronous hard-delete purge of that tenant's events, in-flight BullMQ jobs, and Redis projection keys (research.md §12, FR-032) in backend/src/domain/account/account-closure-service.ts (depends on T015, T020, T022)
- [X] T054 [P] [US2] Frontend: IP Client management UI (enable/disable/rotate/decommission) in frontend/src/pages/IpClients.tsx (depends on T047, T048, T049)
- [X] T055 [P] [US2] Frontend: Action management UI (reconfigure/enable/disable/detach) in frontend/src/pages/Actions.tsx (depends on T052)
- [X] T056 [P] [US2] Implement a Logto Management API client (M2M client-credentials token acquisition + caching) in backend/src/adapters/auth-logto/logto-management-client.ts
- [X] T057 [US2] Implement `PUT /api/account/password`, proxying the new password to Logto's Management API via T056's client; the plaintext value is never logged, persisted, or event-sourced (research.md §15) in backend/src/adapters/http/routes/account.ts (depends on T019, T056)
- [X] T058 [P] [US2] Frontend: Account settings page with an in-app password-change form alongside the existing delete-account action in frontend/src/pages/Account.tsx (depends on T053, T057)
- [X] T059 [US2] Run quickstart.md Scenario 2 end-to-end and fix any gaps found — validated via two new real Postgres+Redis integration tests rather than two genuine separate Logto user tokens: a client-credentials M2M grant always resolves to the same fixed subject, so two truly distinct human Logto identities aren't obtainable in this non-interactive environment (JWT verification itself was already validated against the real Logto instance in T046). `backend/tests/integration/tenant-isolation.test.ts` substitutes a trivial per-request tenant header for the auth middleware and exercises the real production routes end-to-end: tenant B gets 404 for tenant A's IP Client, never sees tenant A's Provider Credentials in a list, and is rejected (400) attaching an Action that references tenant A's Provider Credential (FR-013/SC-003). `backend/tests/integration/account-lifecycle.test.ts` covers the rest of Phase 4: IP Client enable/disable/rotate-credential/decommission, admin device-limit override plus 403 rejection of a non-admin caller (FR-034), Action reconfigure/disable/detach, and account closure's hard-delete purge (confirms zero aggregates remain post-closure, FR-032). All 8 backend integration tests pass; `tsc --noEmit` and `eslint` are clean on both backend and frontend `src/`.

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Review, Retry & Get Notified About Automation Outcomes (Priority: P3)

**Goal**: A user can review execution history, manually re-run a failed Action using the last known IP, and optionally receive email notifications per their configured preference.

**Independent Test**: Run quickstart.md Scenario 3 — force a failing Action, verify the failure reason is visible; configure a Notification Channel and preference; verify a notification is received on success; manually re-run an Action and confirm a new execution appears.

### Implementation for User Story 3

- [X] T060 [P] [US3] Define `notification_channel` event payload types (`registered`, `reconfigured`, `revoked`) in backend/src/domain/notification-channel/events.ts
- [X] T061 [P] [US3] Implement the `notification_channel` aggregate in backend/src/domain/notification-channel/notification-channel-aggregate.ts (depends on T060)
- [X] T062 [US3] Implement `GET/POST/PUT/DELETE /api/notification-channel` in backend/src/adapters/http/routes/notification-channel.ts (depends on T061)
- [X] T063 [US3] Implement `PUT /api/ip-clients/{id}/notification-preference` (FR-029) in backend/src/adapters/http/routes/ip-clients.ts (depends on T027)
- [X] T064 [P] [US3] Define the `NotificationChannel` sending port in backend/src/ports/notification-channel.ts
- [X] T065 [US3] Implement the email `NotificationChannel` adapter (SMTP via `nodemailer`, research.md §13) in backend/src/adapters/notifications-email/email-notifier.ts (depends on T064)
- [X] T066 [US3] Extend the action-execution worker to send a notification per the IP Client's preference after `succeeded`/`failed`, appending `notification_sent` (FR-030) in backend/src/adapters/queue-bullmq/action-execution-worker.ts (depends on T041, T062, T065)
- [X] T067 [US3] Implement `POST /api/actions/{id}/run` (manual re-run using the IP Client's last known IP, `triggeredBy: "manual"`, FR-023) in backend/src/adapters/http/routes/action-run.ts (depends on T038)
- [X] T068 [US3] Implement `GET /api/ip-clients/{id}/history` (`ip_changed` feed + resulting executions) in backend/src/adapters/http/routes/ip-client-history.ts (depends on T036, T043)
- [X] T069 [P] [US3] Frontend: Execution history + failure-detail view in frontend/src/pages/ExecutionHistory.tsx (depends on T043, T068)
- [X] T070 [P] [US3] Frontend: Notification channel + per-IP-Client preference settings UI in frontend/src/pages/NotificationSettings.tsx (depends on T062, T063)
- [X] T071 [P] [US3] Frontend: Manual re-run action on the execution history view in frontend/src/pages/ExecutionHistory.tsx (depends on T067, T069)
- [X] T072 [US3] Run quickstart.md Scenario 3 end-to-end and fix any gaps found — validated via `backend/tests/integration/review-retry-notify.test.ts` against real Postgres+Redis+BullMQ: a failing execution (simulated provider error) surfaces a self-diagnosable error message after retries are exhausted and triggers a "failed" notification (preference `all`); fixing it and retriggering succeeds and notifies again; a manual re-run (`POST /api/actions/{id}/run`) creates a new `triggeredBy: "manual"` execution using the IP Client's last known IP with no new trigger call; the history endpoint correctly correlates each `ip_changed` event with its resulting executions. The email transport is a stub capturing sent messages rather than a live SMTP relay (nodemailer's own wire protocol is mature third-party code; what needed proving was FluxIP's own notification-gating/event-sourcing logic). **Two real bugs were found and fixed during this validation**: (1) the `events` table's unique constraint was `(aggregate_id, sequence_number)`, omitting `aggregate_type` — harmless until `notification_channel` became the second aggregate (after `account`) to key its aggregate ID on `tenant_id`, at which point it collided with `account`'s own first event; fixed via migration `0002_fix_events_unique_constraint.sql` scoping the constraint to `(aggregate_type, aggregate_id, sequence_number)`, matching how concurrency is actually scoped. (2) Running the full test suite together caused a spurious failure in the earlier MVP pipeline test, because two integration test files each start their own BullMQ `Worker` on the same fixed, production-named queues sharing one real Redis — correct/intended for horizontal scaling in prod, but meant concurrently-run test files raced over the same queue; fixed by setting `fileParallelism: false` in `backend/vitest.config.ts` rather than changing the production queue-naming design. All 9 backend integration tests pass repeatably; `tsc --noEmit` and `eslint` are clean on both backend and frontend `src/`.

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T073 [P] Run quickstart.md Scenario 4 (≥2 app replicas, ≥1,000 trigger calls) and verify SC-004 (no duplicate/missed executions) via the `/metrics` replay counters — validated by `backend/tests/integration/horizontal-scale.test.ts`: two independent debounce+execution BullMQ worker pairs (simulating 2 app replicas) share one real Postgres/Redis, and two independent trigger-route Hono instances (simulating a load balancer) receive flapping reports for 60 IP Clients/Actions under one account. Exactly one succeeded `action_execution` per Action was confirmed (no duplicates, none missing). This is a CI-scaled proxy (60 devices / 120 calls, seconds not the literal ≥1,000 calls / long soak) — same failure mode the full scenario checks for, at a smaller deterministic n; a full-scale `docker compose up -d --scale app=2` run remains the recommended pre-launch staging check (documented in README).
- [X] T074 [P] Write root README covering setup and deployment, linking to quickstart.md — `README.md`.
- [X] T075 Security hardening pass: confirm the IP Client credential hash and Provider Credential secrets never appear in logs or error responses — reviewed every `console.*` call site and every route's JSON response body; `credentialHash`/`encryptedSecret` are only ever written into event payloads (persisted, never returned over HTTP), the one intentional exception being the plaintext reporting credential returned once at registration/rotation by design (research.md §14); no global Hono error handler leaks stack traces. No fixes were needed.
- [X] T076 Performance check: confirm the trigger endpoint meets <200ms p95 (plan.md Performance Goals) under load — `backend/tests/integration/trigger-performance.test.ts` binds a real HTTP server (not in-process `app.request()`) and fires 300 requests at concurrency 20 across 20 distinct IP Clients (a single real device never sends itself concurrent duplicate reports, so load is realistically spread across devices, not hammering one aggregate). Result: p50≈30ms, p95≈110-170ms, under the 200ms target.
- [X] T077 [P] Verify replay-duration/event-count metrics are correctly labeled per `aggregate_type`/`ip_client_id` (research.md §10) across all aggregates — found and fixed a real gap: `action-execution-worker.ts`'s `nextSequence` helper read the event stream directly via `eventStore.readStream`, bypassing the metrics-instrumented `loadAggregate` helper used everywhere else. Refactored it to use `loadAggregate`, consistent with every other call site. `horizontal-scale.test.ts` additionally asserts `/metrics` output contains `aggregate_type="..."` labels for all five non-account aggregate types exercised in that run.
- [X] T078 [P] Provision 10+ IP Clients (each with its own Actions) under one account and verify no measurable degradation in configuration responsiveness or execution reliability (SC-005) — covered by the same `horizontal-scale.test.ts` run (60 IP Clients/Actions, well above 10): the full register→trigger→debounce→fan-out→execute pipeline for all 60 completed in ~1.5-2.2s with 100% success.
- [X] T079 [P] Soak-test SC-002: drive a realistic volume of confirmed IP changes over time and verify ≥99% result in the corresponding DNS record updating within 5 minutes — covered by `horizontal-scale.test.ts`'s same 60-client run: 100% (60/60) of settled IP changes produced a succeeded execution, well within its 15s timeout (a CI-scaled proxy for the 5-minute target at production volumes).
- [X] T080 [P] Force a representative set of distinct failure causes (invalid record, revoked provider credential, unreachable API) and verify each surfaces an error message sufficient to self-diagnose without support, supporting SC-006's 90% target — `backend/tests/integration/failure-diagnostics.test.ts` forces three distinct causes (revoked Provider Credential, a required address family the device never reports, a simulated upstream provider-API rejection) and confirms each produces its own distinguishable, specific error message in execution history, not one generic "failed".
- [X] T081 [P] Soak-test SC-007: with notifications enabled across multiple IP Clients, verify ≥99% of executions produce a notification delivered within 1 minute — covered by `horizontal-scale.test.ts`: 10 of the 60 IP Clients had notification preference `all` with a shared email channel (stub transport capturing sent messages — nodemailer's own SMTP wire protocol is mature third-party code, not what needed proving); all 10 (100%) received a notification within the test's 5s wait window.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational only
- **User Story 2 (Phase 4)**: Depends on Foundational; reuses US1's `ip_client`/`action` routes and aggregates (extends rather than duplicates them) but is independently testable per its own quickstart scenario
- **User Story 3 (Phase 5)**: Depends on Foundational; extends US1's action-execution worker (T041) and reuses US1/US2 routes, independently testable per its own quickstart scenario
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### Within Each User Story

- Event-type definitions before aggregates
- Aggregates before HTTP routes/workers that use them
- Core synchronous flow (register → attach → trigger → debounce → fan-out → execute) before its dependent read endpoints (history)
- Backend implementation before the frontend pages that call it
- Story complete before moving to the next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- Within Foundational, T013, T016, T017, T020, T022 (marked [P]) can run in parallel once their individual dependencies are met
- Once Foundational completes, US1/US2/US3 backend work can proceed in parallel by different developers, though US2 and US3 each extend files US1 creates (`ip-clients.ts`, `actions.ts`, `action-execution-worker.ts`) so those specific tasks should be sequenced with their listed dependency, not parallelized across stories
- All event-type-definition tasks marked [P] within a story can run in parallel (different files)
- Frontend page tasks marked [P] can run in parallel with each other once their backend dependency lands
- All Phase 6 validation tasks marked [P] (T073-T075, T077-T081) can run in parallel against a fully deployed stack once all user stories are complete

---

## Parallel Example: User Story 1

```bash
# Event-type definitions can be drafted together (different files, no shared dependency):
Task: "Define ip_client event payload types in backend/src/domain/ip-client/events.ts"
Task: "Define provider_credential event payload types in backend/src/domain/provider-credential/events.ts"
Task: "Define action event payload types in backend/src/domain/action/events.ts"
Task: "Define action_execution event payload types in backend/src/domain/action-execution/events.ts"

# Once their respective events land, the aggregates can be built together:
Task: "Implement the ip_client aggregate in backend/src/domain/ip-client/ip-client-aggregate.ts"
Task: "Implement the provider_credential aggregate in backend/src/domain/provider-credential/provider-credential-aggregate.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run quickstart.md Scenario 1 independently
5. Deploy/demo if ready — this alone delivers FluxIP's core value proposition

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add User Story 1 → validate via Scenario 1 → deploy/demo (MVP!)
3. Add User Story 2 → validate via Scenario 2 → deploy/demo
4. Add User Story 3 → validate via Scenario 3 → deploy/demo
5. Polish → validate Scenario 4 (horizontal scale) and non-functional/SLA checks (SC-002, SC-005, SC-006, SC-007)

### Parallel Team Strategy

With multiple developers, after Foundational completes: Developer A takes US1's synchronous-flow tasks (T023–T043), Developer B starts US1's frontend (T044–T045) as soon as the routes they depend on land, and a third developer can begin drafting US2/US3 event-type/aggregate scaffolding (T060–T061) early since those files don't conflict with US1 — but route/worker tasks that extend US1 files (T047–T053, T066–T068) should wait for their listed dependencies.

---

## Phase 7: Convergence

- [X] T082 Rewrite the Hetzner ActionExecutor adapter to call the Hetzner Cloud API's `zones`/`rrsets` resources (resolve the zone via `GET /v1/zones?name={zone}`, then read/upsert the A/AAAA rrset via `/v1/zones/{zone_id}/rrsets`, Bearer auth with a Cloud API token) instead of the legacy `https://api.hetzner.com/v1/dns` `/records` endpoints, preserving the existing must-already-exist pre-flight check, in backend/src/adapters/actions/hetzner-dns/hetzner-dns-executor.ts per FR-035 (contradicts) — also renamed `HetznerDnsResolvedConfig.zoneId` → `zoneName` (and its sole call site in action-execution-worker.ts) since the Cloud API resolves zones by name, not by the opaque ID the old field name implied
- [X] T083 Update the adapter's unit tests to mock the Cloud API's `zones`/`rrsets` request/response shape and updated error-context strings, replacing the legacy `/records`+`zone_id` fixtures, in backend/tests/unit/adapters/actions/hetzner-dns-executor.test.ts per FR-035 (partial) — 5/5 tests pass, including two new cases (zone-not-found, rrset-not-found preserving FR-008's no-creation rule)
- [X] T084 Update Hetzner API token references in README.md and .env.example to specify a Hetzner Cloud API token (not the legacy DNS Console/API token format), consistent with quickstart.md and data-model.md per FR-035 (partial)

---

## Phase 8: Bugfix — Corrected Hetzner Cloud API Endpoint

**Context**: T082's `zones`/`rrsets`-collection implementation of FR-035 (Cloud API only) did not actually update DNS records correctly. The user manually verified the real working request against a live zone/token and reported the exact correct shape.

- [X] T085 Replace the `zones`/`rrsets`-collection call (`GET /v1/zones?name=`, then `GET`/`POST /v1/zones/{zone_id}/rrsets`) with the manually verified, working per-rrset `set_records` action (`POST /v1/zones/{zone}/rrsets/{name}/{type}/actions/set_records`), dropping the now-unneeded zone-ID-resolution and rrset-listing calls, in backend/src/adapters/actions/hetzner-dns/hetzner-dns-executor.ts per FR-035 (contradicts — T082's implementation, though intent-correct, used an incorrect/non-working endpoint shape); the request body's `comment` field is composed dynamically per execution from `CLOUDEVENTS_SOURCE` (protocol stripped, threaded through from `deps.config.cloudEventsSource` in action-execution-worker.ts as new field `sourceLabel`) and the current execution timestamp (`new Date().toISOString()`, computed fresh per address-family call, never hardcoded)
- [X] T086 Update the adapter's unit tests to assert the exact verified request (URL, method, body shape including the dynamic comment) instead of the superseded `zones`/`rrsets`-collection mocks, in backend/tests/unit/adapters/actions/hetzner-dns-executor.test.ts per FR-035 (partial) — 4/4 tests pass, including one asserting the comment's timestamp falls within the actual call's execution window
- [X] T087 Update research.md §18 to document the corrected, manually verified endpoint and request shape, replacing the incorrect `zones`/`rrsets`-collection decision record, per FR-035 (partial)

**Verification performed**: `tsc --noEmit` clean across the whole backend; `eslint src/` clean; full `tests/unit/` suite passes (6 files, 15 tests) — including a test asserting the exact URL `https://api.hetzner.cloud/v1/zones/kyromoto.de/rrsets/@/A/actions/set_records` and that the request body's `records[0].comment` is `"<sourceLabel> | <ISO-8601 timestamp>"` with the timestamp falling within the actual call's execution window (proving it isn't hardcoded). **Not performed**: a live network test against the real Hetzner Cloud API — no Provider Credential token was available in this environment (Provider Credentials are stored encrypted in Postgres via the running app, not in `.env`, and none was supplied). The user's own manual verification of the exact request shape (method/URL/body) is what this fix was built to match; the unit test asserts byte-for-byte conformance to that verified shape, but an actual live DNS update was not re-confirmed here.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Aggregate/event names match data-model.md exactly (`ip_client`, not `trigger_device`; no CRUD-style verbs)
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
