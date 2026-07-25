# Implementation Plan: Frontend Runtime Configuration

**Branch**: `006-frontend-runtime-config` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-frontend-runtime-config/spec.md`

## Summary

The frontend's four deployment-specific values (Logto endpoint/app ID/API resource, backend URL) currently get compiled into the JS bundle at `vite build` time via `import.meta.env.VITE_*`, so a new deployment needs a new image. This plan adds a Docker `ENTRYPOINT` script that runs on every container start, generates `frontend/dist/config.js` (a `window.__ENV__ = {...}` object safely JSON-encoded from `FRONTEND_*` environment variables) via a small Node helper, and rewrites a cache-busting query token in `frontend/dist/index.html` so page loads after a restart fetch the fresh config rather than a stale cached copy. `index.html` loads `config.js` before the main bundle. Frontend source code reads deployment-specific values through a new `src/config.ts` accessor that prefers `window.__ENV__` and falls back to `import.meta.env.VITE_*` — the latter keeps local dev (`vite dev`, out of scope for this feature) working unchanged, since dev never gets a generated `config.js`. `serve`'s existing `-s` SPA-fallback flag becomes `--single` (same behavior, explicit per the request); this only affects the `frontend` runtime role's start command, not the entrypoint mechanism, which runs for both roles from the one shared image established in `specs/002-docker-release-pipeline`.

## Technical Context

**Language/Version**: POSIX `sh` (the entrypoint script — matches `.specify/init-options.json`'s `script: sh`) + Node.js 22 (already the runtime image's language, used for safe JSON-encoding of env values — see research.md §1) + TypeScript/SolidJS (existing frontend source, unchanged toolchain).

**Primary Dependencies**: No new runtime npm dependencies. Reuses `serve` (already a frontend dependency, flag changes from `-s` to `--single`) and Node's built-in `JSON.stringify`/`fs` (no templating library needed for config generation).

**Storage**: N/A — the generated configuration is regenerated from environment variables on every container start and is not persisted beyond the container's filesystem/lifetime.

**Testing**: Vitest unit tests (`frontend/tests/unit`) for the new `src/config.ts` accessor's `window.__ENV__` → `import.meta.env` fallback logic and for the Node config-generation script's JSON-encoding/escaping. Extends the existing GitHub Actions Docker smoke tests (`specs/002-docker-release-pipeline`'s `release.yml`) to assert `config.js` is generated with the expected values and that a deep in-app route still returns the SPA shell under `serve --single`. Playwright e2e (`frontend/tests/e2e`, which runs against `pnpm dev`) is out of scope for the runtime-config path itself, since dev doesn't use `window.__ENV__` (FR-011).

**Target Platform**: Linux containers (the existing `node:22-slim`-based image from `specs/002-docker-release-pipeline`); any evergreen browser as the consumer of `window.__ENV__`.

**Project Type**: Web application (existing `backend/` + `frontend/` structure) — this feature touches the shared root `Dockerfile`/entrypoint and frontend source/build output only; the backend is unaffected except that the same entrypoint script now wraps its container start too (see research.md §5).

**Performance Goals**: N/A — no user-facing runtime performance target; the entrypoint's added work (writing one small JSON file, one string substitution in `index.html`) is expected to add well under a second to container start.

**Constraints**: Must not require a different image build per deployment or per role (FR-009); generated configuration must be safe against script injection from env var values (FR-007); the entrypoint must not fail or hang the *backend* role's container start when frontend-only `FRONTEND_*` values are absent, since both roles share one image and one entrypoint (research.md §5).

**Scale/Scope**: One Docker image, four runtime-configurable values initially (`FRONTEND_LOGTO_ENDPOINT`, `FRONTEND_LOGTO_APP_ID`, `FRONTEND_LOGTO_API_RESOURCE`, `FRONTEND_BACKEND_URL`), designed to extend to more without redesign (per spec Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` currently ratifies only the Explicit Commit Authorization principle (a process rule: no automatic commits), which imposes no design-time gate on this plan. No other principles are defined, so no additional gates apply.

**Post-design re-check**: Phase 1 design adds one new small Node script and one shell entrypoint to the existing single Dockerfile from `specs/002-docker-release-pipeline`, plus a frontend-side config accessor module — no new services, no new orchestration abstractions, no new runtime dependencies. Still no gates to fail.

## Project Structure

### Documentation (this feature)

```text
specs/006-frontend-runtime-config/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/             # Phase 1 output
└── tasks.md               # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
Dockerfile                            # MODIFIED: COPY the new entrypoint script + Node
                                       # helper into the image; add
                                       # ENTRYPOINT ["/app/docker-entrypoint.sh"] wrapping
                                       # both roles' existing CMD/command (research.md §5)

docker-entrypoint.sh                  # NEW: repo-root shell entrypoint — regenerates
                                       # frontend/dist/config.js (if the dir exists) and
                                       # execs "$@" (the role-specific start command)

frontend/
├── scripts/
│   └── generate-runtime-config.mjs   # NEW: Node helper — safely JSON-encodes FRONTEND_*
│                                     # env vars into dist/config.js as window.__ENV__,
│                                     # warns (stdout) on missing values (FR-008), and
│                                     # rewrites index.html's cache-bust token (FR-010)
├── public/
│   └── config.js                    # NEW: empty `window.__ENV__ = {};` placeholder —
│                                     # copied into dist/ by `vite build`; gives local dev
│                                     # a defined-but-empty window.__ENV__ instead of a
│                                     # 404, and is overwritten at container start in prod
├── index.html                        # MODIFIED: add
│                                     # <script src="/config.js?v=__CONFIG_VERSION__">
│                                     # before the main bundle's module script
├── src/
│   ├── config.ts                    # NEW: typed accessor — window.__ENV__ first, falls
│   │                                 # back to import.meta.env.VITE_* (dev only, FR-011)
│   ├── window-env.d.ts               # NEW: `Window.__ENV__` global type declaration
│   ├── services/
│   │   ├── auth.ts                  # MODIFIED: read Logto values via src/config.ts
│   │   └── api.ts                   # MODIFIED: read backend URL via src/config.ts,
│   │                                 # prefix requests with it instead of assuming
│   │                                 # same-origin relative /api
│   └── vite-env.d.ts                 # MODIFIED: add readonly VITE_BACKEND_URL?: string;
│                                     # to ImportMetaEnv (research.md §8 dev fallback)
└── tests/unit/
    └── config.test.ts                # NEW: window.__ENV__ / import.meta.env fallback

frontend/.env                         # MODIFIED: add VITE_BACKEND_URL= (empty, dev-only
                                       # fallback default — research.md §8)

docker-compose.yml                    # MODIFIED: frontend service gets `env_file: .env`
                                       # (matching the `app` service) and its command's
                                       # `-s` flag becomes `--single`

.env.example                          # MODIFIED: add FRONTEND_LOGTO_ENDPOINT/_APP_ID/
                                       # _API_RESOURCE/_BACKEND_URL alongside the existing
                                       # backend LOGTO_* vars

.github/workflows/release.yml          # MODIFIED: frontend smoke test's `serve` command
                                       # uses `--single`; asserts config.js reflects
                                       # supplied FRONTEND_* env vars and that a deep
                                       # route still returns 200 (SPA fallback intact)

README.md                              # MODIFIED: Configuration section documents the
                                       # new FRONTEND_* vars; Release process section's
                                       # example `docker run` commands use `--single`
```

**Structure Decision**: Existing `backend/` + `frontend/` web-application layout, unchanged. This feature adds one repo-root entrypoint script (alongside the existing repo-root `Dockerfile` from `specs/002-docker-release-pipeline`) and a small number of new/modified files inside `frontend/`; no new top-level directories or services.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — this section is intentionally empty.
