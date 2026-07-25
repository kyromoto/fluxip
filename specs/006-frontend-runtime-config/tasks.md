---

description: "Task list for Frontend Runtime Configuration"
---

# Tasks: Frontend Runtime Configuration

**Input**: Design documents from `/specs/006-frontend-runtime-config/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not explicitly requested in spec.md as TDD, but plan.md's Technical Context commits to specific test coverage (a Vitest unit test for the `window.__ENV__`/`import.meta.env` fallback and warning logic, plus extending the existing Docker smoke tests from `specs/002-docker-release-pipeline`). Those are included as regular tasks within their owning story. Each user-story phase also ends with a "Run quickstart.md Scenario N" task, which is that story's independent-test checkpoint.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

## Path Conventions

Existing `backend/` + `frontend/` web-application layout (plan.md's Structure Decision). This feature adds one repo-root entrypoint script (alongside the existing repo-root `Dockerfile` from `specs/002-docker-release-pipeline`) and touches a small number of files inside `frontend/`, plus `docker-compose.yml`, `.env.example`, `.github/workflows/release.yml`, and `README.md`. No new top-level directories.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New, dependency-free scaffolding files usable by later phases

- [X] T001 [P] Create the `WindowEnv` type declaration at `frontend/src/window-env.d.ts` per `contracts/window-env.md` (`interface WindowEnv { LOGTO_ENDPOINT?: string; LOGTO_APP_ID?: string; LOGTO_API_RESOURCE?: string; BACKEND_URL?: string; }`, augmenting the global `Window` interface with an optional `__ENV__: WindowEnv`)
- [X] T002 [P] Create the build-time placeholder `frontend/public/config.js` containing exactly `window.__ENV__ = {};` (research.md §4) — copied verbatim into `frontend/dist/` by `vite build` and served as-is by `vite dev`
- [X] T003 [P] Add `FRONTEND_LOGTO_ENDPOINT`, `FRONTEND_LOGTO_APP_ID`, `FRONTEND_LOGTO_API_RESOURCE`, `FRONTEND_BACKEND_URL` (all empty, commented with a one-line purpose each) to `.env.example`, grouped near the existing `LOGTO_*` block (data-model.md, research.md §2)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Wire the `ENTRYPOINT` hook point into the shared image without changing container-start behavior yet — every later phase that touches container startup builds on this

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Create `docker-entrypoint.sh` at the repo root: `#!/bin/sh`, `set -e`, and `exec "$@"` as the only behavior for now — a pure passthrough wrapper (contracts/docker-entrypoint.md's invocation contract, step 2)
- [X] T005 Modify `Dockerfile`: `COPY docker-entrypoint.sh /app/docker-entrypoint.sh`, `COPY --from=build /app/frontend/scripts /app/frontend/scripts` (the Node config-generation helper — without this, `docker-entrypoint.sh`'s `node` call in T010 fails and, combined with `set -e`, aborts container start for both roles), `RUN chmod +x /app/docker-entrypoint.sh`, and add `ENTRYPOINT ["/app/docker-entrypoint.sh"]` in the `runtime` stage (after the existing `COPY --from=build ... frontend/dist` line) — depends on T004
- [X] T006 Run quickstart.md Scenario 5 (backend role) to confirm the new `ENTRYPOINT` wrapper doesn't change backend container startup — depends on T005

**Checkpoint**: The image starts either role exactly as before, now via an entrypoint wrapper that does nothing extra yet. Ready for user story work.

---

## Phase 3: User Story 1 - Deploy the same image to a new environment without rebuilding (Priority: P1) 🎯 MVP

**Goal**: An operator can set `FRONTEND_*` environment variables on the built image and, without a rebuild, get a running frontend whose `window.__ENV__` reflects those values.

**Independent Test**: Run quickstart.md Scenarios 1 and 2 — start the image with one set of `FRONTEND_*` values, confirm `/config.js` reflects them; restart with different values (no rebuild) and confirm the new values appear; confirm a hostile value in an env var comes through as an inert, safely-escaped string.

### Implementation for User Story 1

- [X] T007 [P] [US1] Create `frontend/scripts/generate-runtime-config.mjs` exporting `buildConfig(env)` — reads `FRONTEND_LOGTO_ENDPOINT`/`FRONTEND_LOGTO_APP_ID`/`FRONTEND_LOGTO_API_RESOURCE`/`FRONTEND_BACKEND_URL` from a given env object and returns `{ LOGTO_ENDPOINT, LOGTO_APP_ID, LOGTO_API_RESOURCE, BACKEND_URL }` (empty string for any that are unset), and `renderConfigJs(config)` — returns `` `window.__ENV__ = ${JSON.stringify(config)};` `` (research.md §1, contracts/window-env.md)
- [X] T008 [US1] In `frontend/scripts/generate-runtime-config.mjs`, add `renderIndexHtml(html, token)` — replaces the literal `__CONFIG_VERSION__` placeholder in an HTML string with `token` — and a `main()` that: calls `buildConfig(process.env)`, writes `frontend/dist/config.js` via `renderConfigJs`, reads `frontend/dist/index.html`, writes it back through `renderIndexHtml` with `Date.now()` as the token, and runs `main()` when the module is executed directly (research.md §6) — depends on T007
- [X] T009 [P] [US1] Add `<script src="/config.js?v=__CONFIG_VERSION__"></script>` to `frontend/index.html`, immediately before the existing `<script type="module" src="/src/main.tsx"></script>` (FR-002)
- [X] T010 [US1] Update `docker-entrypoint.sh` to run `node /app/frontend/scripts/generate-runtime-config.mjs` when `/app/frontend/dist` exists, before `exec "$@"` (contracts/docker-entrypoint.md step 1) — depends on T006, T008
- [X] T011 [P] [US1] Create `frontend/src/config.ts` exporting `getLogtoEndpoint()`, `getLogtoAppId()`, `getLogtoApiResource()`, `getBackendUrl()` — each returns `window.__ENV__?.<KEY>` if it's a non-empty string, else the corresponding `import.meta.env.VITE_*` value, else `""` (contracts/window-env.md's consumer contract, research.md §3) — depends on T001
- [X] T012 [US1] Update `frontend/src/services/auth.ts` to read `endpoint`/`appId`/`apiResource` via `frontend/src/config.ts`'s getters instead of `import.meta.env.VITE_LOGTO_*` directly — depends on T011
- [X] T013 [US1] Update `frontend/src/services/api.ts` to read the backend URL via `frontend/src/config.ts`'s `getBackendUrl()` and prefix every request with it (`` `${backendUrl}/api${path}` ``) instead of assuming a same-origin relative `/api` path (research.md §8) — depends on T011
- [X] T014 [P] [US1] Add `VITE_BACKEND_URL=` (empty) to `frontend/.env` and `readonly VITE_BACKEND_URL?: string;` to `frontend/src/vite-env.d.ts`'s `ImportMetaEnv` interface (research.md §8, dev-only fallback)
- [X] T015 [US1] Add `env_file: .env` and note the four new `FRONTEND_*` variables in a comment on the `frontend` service in `docker-compose.yml` — depends on T003
- [X] T016 [P] [US1] Extend the "Smoke test frontend role" step in `.github/workflows/release.yml`: pass `-e FRONTEND_LOGTO_ENDPOINT=... -e FRONTEND_LOGTO_APP_ID=... -e FRONTEND_LOGTO_API_RESOURCE=... -e FRONTEND_BACKEND_URL=...` (dummy smoke-test values) to the `docker run`, then `curl -s http://localhost:3000/config.js` and assert the response contains those values before the existing `/` health check
- [X] T017 [P] [US1] Document the four new `FRONTEND_*` env vars in `README.md`'s Configuration section, alongside the existing `BACKEND_LOGTO_ENDPOINT` bullet
- [X] T018 [US1] Create `frontend/tests/unit/config.test.ts` covering `frontend/src/config.ts`'s fallback logic: `window.__ENV__` value present → used; `window.__ENV__` value empty/absent → falls back to `import.meta.env.VITE_*`; both absent → returns `""` — depends on T011
- [X] T019 [US1] Run quickstart.md Scenarios 1 and 2 end-to-end and fix any gaps found — confirm a restart with different `FRONTEND_*` values (no rebuild) changes `/config.js`'s contents, and confirm a hostile value (e.g. `</script><script>alert(1)</script>`) renders as an inert string, not executable script — depends on T007-T017

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 - Deep-link into the single-page app still works (Priority: P2)

**Goal**: Direct requests to any in-app route still return the SPA shell, now under `serve --single` instead of `serve -s`.

**Independent Test**: Run quickstart.md Scenario 3 — request a deep, non-root in-app URL directly and confirm it returns the app shell (200, not 404); request an existing static asset by its exact path and confirm it's returned unchanged.

### Implementation for User Story 2

- [X] T020 [US2] Change the `frontend` service's `command` in `docker-compose.yml` from `["serve", "-s", "frontend/dist", "-l", "3000"]` to `["serve", "--single", "frontend/dist", "-l", "3000"]` (research.md §7) — depends on T015 (same file, sequential)
- [X] T021 [US2] Update the "Smoke test frontend role" step in `.github/workflows/release.yml`: change `serve -s frontend/dist -l 3000` to `serve --single frontend/dist -l 3000`, and add a `curl` check for a non-root in-app path (e.g. `/some/deep/route`) asserting `200` alongside the existing `/` check (FR-005) — depends on T016 (same file, sequential)
- [X] T022 [US2] Update `README.md`'s Release process section: change the example `docker run ... serve -s frontend/dist -l 3000` command to `serve --single frontend/dist -l 3000` — depends on T017 (same file, sequential)
- [X] T023 [US2] Run quickstart.md Scenario 3 end-to-end and fix any gaps found — depends on T020, T021

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Missing or incomplete runtime configuration is easy to diagnose (Priority: P3)

**Goal**: An operator who omits a required `FRONTEND_*` value gets a clear, discoverable warning, and the container still starts and serves.

**Independent Test**: Run quickstart.md Scenario 4 — start the container with one required value omitted; confirm a warning naming that variable appears in `docker logs`, and confirm the container still responds `200`.

### Implementation for User Story 3

- [X] T024 [US3] Extend `frontend/scripts/generate-runtime-config.mjs`'s `main()` to print one line to stdout per key in `buildConfig`'s result that is empty (e.g. `` `docker-entrypoint: FRONTEND_${originalVarName} is not set` ``), naming the original `FRONTEND_*` env var (contracts/docker-entrypoint.md step 1b) — depends on T008
- [X] T025 [US3] Extend `frontend/src/services/api.ts` to `console.warn` once (at module load) when the runtime config's `BACKEND_URL` key is present but empty — deviated from literally checking `getBackendUrl() === ""` because that also matches local dev's intentional empty default (research.md §8), which would have made the warning fire on every dev page load; instead checks `"BACKEND_URL" in window.__ENV__ && !window.__ENV__.BACKEND_URL`, which is only true once the Docker entrypoint has actually generated `config.js` with an empty value — depends on T013
- [X] T026 [P] [US3] Add `frontend/tests/unit/generate-runtime-config.test.ts` covering: `buildConfig` with a missing env var still returns `""` for that key (never throws), and `warnAboutMissingValues`'s (T024) per-missing-key logging — depends on T018, T024
- [X] T027 [US3] Run quickstart.md Scenario 4 end-to-end and fix any gaps found — confirm the container still serves (`200`) despite a missing value, and the warning is visible via `docker logs` without inspecting compiled JS — depends on T024, T025

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Guarantees that cut across all user stories

- [X] T028 [P] Re-run quickstart.md Scenario 5 (backend role) now that config generation and warnings are fully wired, confirming the backend role is still unaffected by the entrypoint's frontend-config step (research.md §5)
- [X] T029 [P] Security review: manually verify in a real browser that the injection payload from quickstart.md Scenario 2 (FR-007) is rendered as an inert string and does not execute, not just that it "looks escaped" in `config.js`'s raw text — done during T019 via a headless-Chromium (Playwright) check: `window.__ENV__.LOGTO_ENDPOINT` equals the literal hostile string and no `alert()` dialog fires. Also confirmed this is inherently safe because `config.js` is always loaded as an *external* script (`<script src="/config.js?...">`), never inlined into `index.html` — so a `</script>` substring inside the JSON payload cannot prematurely close an HTML `<script>` element the way it could if the config were ever inlined
- [X] T030 Grep `frontend/src` for any remaining direct `import.meta.env.VITE_LOGTO_*`/`import.meta.env.VITE_BACKEND_URL` reads outside `frontend/src/config.ts` and remove/redirect them through the accessor (FR-003) — confirmed clean: the only `import.meta.env` reads in `frontend/src` are the four inside `config.ts` itself

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: No dependencies on Setup's files, but conventionally done after — BLOCKS all user stories that touch container startup (US1, indirectly US3); US2 does not functionally depend on it but follows it in priority order regardless
- **User Story 1 (Phase 3)**: Depends on Foundational (T004-T006) and Setup (T001-T003)
- **User Story 2 (Phase 4)**: Depends on User Story 1's `docker-compose.yml`/`release.yml`/`README.md` edits (T015-T017) only because it edits the same files next — no functional dependency on US1's config-generation mechanism
- **User Story 3 (Phase 5)**: Depends on User Story 1's `generate-runtime-config.mjs` and `config.ts`/`api.ts` (T008, T013, T018) — it extends them with warning behavior
- **Polish (Phase 6)**: Depends on all three user stories being complete

### Within Each User Story

- `generate-runtime-config.mjs`'s exports (T007) before anything that calls them (T008, T010, T024)
- `config.ts` (T011) before its consumers (`auth.ts` T012, `api.ts` T013)
- `docker-compose.yml`/`release.yml`/`README.md` edits within a story are sequential across stories (same files touched by US1 then US2)
- Story complete before moving to the next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T001-T003 — three different files)
- T007, T009, T011, T014 (Phase 3) touch different files and can run in parallel; T016/T017 (also [P]) touch different files from each other and from T007-T014
- All Phase 6 Polish tasks marked [P] can run in parallel once all three user stories are complete
- Tasks editing the same file within or across phases (`generate-runtime-config.mjs`, `docker-compose.yml`, `.github/workflows/release.yml`, `README.md`) are sequential, not parallel

---

## Parallel Example: User Story 1

```bash
# Launch independent Phase 3 file-creation tasks together:
Task: "Create frontend/scripts/generate-runtime-config.mjs with buildConfig/renderConfigJs"
Task: "Add <script src=/config.js?v=__CONFIG_VERSION__> to frontend/index.html"
Task: "Create frontend/src/config.ts with window.__ENV__/import.meta.env fallback getters"
Task: "Add VITE_BACKEND_URL to frontend/.env and vite-env.d.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — the entrypoint hook point)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1 and 2 independently
5. This ships the core runtime-configuration capability — the same built image is deployable to a new environment via env vars + restart alone

### Incremental Delivery

1. Setup + Foundational → the image still starts exactly as before, now via a passthrough entrypoint
2. Add User Story 1 → validate via Scenarios 1-2 → operators can redeploy without rebuilding (MVP!)
3. Add User Story 2 → validate via Scenario 3 → SPA deep-linking is confirmed intact under `--single`
4. Add User Story 3 → validate via Scenario 4 → missing-config diagnosability is confirmed
5. Polish → re-validate Scenario 5 and the injection-safety guarantee end-to-end in a real browser

### Parallel Team Strategy

Given this feature centers on a handful of shared files (`docker-compose.yml`, `.github/workflows/release.yml`, `README.md`, `generate-runtime-config.mjs`), most cross-story work on those files is inherently sequential. The realistic parallelism is within Phase 3: one person on `generate-runtime-config.mjs` (T007-T008, T010) while another builds `frontend/src/config.ts` and its consumers (T011-T014) — both converge before T015-T019.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- This feature touches the shared root `Dockerfile`/`docker-compose.yml` from `specs/002-docker-release-pipeline`, adds one repo-root `docker-entrypoint.sh`, and adds/modifies a small number of files under `frontend/` (plan.md's Structure Decision) — no backend application code changes
- Do not commit automatically; commits are only created on the user's explicit request (see constitution's Explicit Commit Authorization principle)
- Stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
