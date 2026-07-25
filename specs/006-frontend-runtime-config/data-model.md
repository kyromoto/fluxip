# Phase 1 Data Model: Frontend Runtime Configuration

This feature has no application database — its "data model" is the runtime configuration object and the artifacts that produce/consume it, per spec.md's Key Entities. This document defines those entities, their fields, and the container-start lifecycle that ties them together.

## Entity: Deployment Configuration

The set of deployment-specific values the running frontend needs, sourced from environment variables at container start (spec.md Key Entities).

| Field (env var) | `window.__ENV__` key | Type | Required | Notes |
|---|---|---|---|---|
| `FRONTEND_LOGTO_ENDPOINT` | `LOGTO_ENDPOINT` | string (URL) | Yes | Logto OIDC issuer endpoint the frontend's `@logto/browser` client connects to |
| `FRONTEND_LOGTO_APP_ID` | `LOGTO_APP_ID` | string | Yes | Logto SPA application ID (distinct from the backend's own `BACKEND_LOGTO_APP_ID`, a different Logto application — research.md §2) |
| `FRONTEND_LOGTO_API_RESOURCE` | `LOGTO_API_RESOURCE` | string (URL) | Yes | API resource indicator requested so Logto issues a signed JWT rather than an opaque token (see existing `frontend/src/services/auth.ts` comment) |
| `FRONTEND_BACKEND_URL` | `BACKEND_URL` | string (URL or empty) | Yes in production; defaults to `""` (same-origin) in local dev only | Prefixed onto every `frontend/src/services/api.ts` request (research.md §8) |

**Identity/uniqueness**: N/A — one Deployment Configuration is in effect per running container; it has no identity beyond "whatever is currently loaded into `window.__ENV__`".

**Lifecycle**: Computed fresh from environment variables at every container start (FR-006); not persisted anywhere beyond the running container's filesystem (`frontend/dist/config.js`) and the browser's in-memory `window.__ENV__` for the lifetime of a loaded page. A container restart with different environment variables produces a new Deployment Configuration; pages loaded before that restart keep the old one in memory until reloaded (FR-010, research.md §6).

**Validation rule**: A missing required value MUST NOT be silently treated as valid (FR-008) — its key is present in `window.__ENV__` with an empty/falsy value, and the missing value is surfaced via a startup warning (Runtime Config Warning, below) and/or the affected feature's own failure mode (e.g. `auth.ts`'s existing `console.warn` when Logto values are falsy, extended to `BACKEND_URL`).

## Entity: Generated Config Artifact (`config.js`)

The physical file the entrypoint writes into the build output directory, and the only channel by which Deployment Configuration reaches the browser (FR-002).

| Field | Type | Notes |
|---|---|---|
| `path` | `frontend/dist/config.js` | Overwritten on every container start (FR-006); a build-time placeholder (`frontend/public/config.js`, research.md §4) occupies this path before the first entrypoint run |
| `contents` | `window.__ENV__ = <JSON>;` | `<JSON>` is `JSON.stringify` of the Deployment Configuration object — safe against injection by construction (FR-007, research.md §1) |
| `servedBy` | `serve --single` (prod) / Vite's static `public/` handling (dev) | In prod, `serve --single`'s SPA fallback does not intercept this request because the file physically exists on disk (User Story 2) |

**Relationship**: `Generated Config Artifact (1) ──produced-from──> (1) Deployment Configuration` per container start. `index.html (1) ──references──> (1) Generated Config Artifact` via a `<script>` tag that loads before the main bundle (FR-002).

## Entity: Cache-Bust Token

The value substituted into `index.html`'s reference to `config.js` on each container start, so a fresh page load after a restart fetches the current `config.js` rather than a cached one (FR-010).

| Field | Type | Notes |
|---|---|---|
| `placeholder` | literal string `__CONFIG_VERSION__` | Present verbatim in the source `frontend/index.html`, left untouched by `vite build` (it's not inside a `type="module"` script Vite resolves — research.md §6) |
| `value` | string (timestamp) | Computed once per container start by the entrypoint's Node helper; written into `frontend/dist/index.html` in place of the placeholder |

**Lifecycle**: Regenerated every container start alongside the Generated Config Artifact, by the same script invocation (research.md §1/§6). Not persisted or reused across restarts.

## Entity: Runtime Config Warning

The observable signal produced when a required Deployment Configuration value is missing (FR-008, User Story 3).

| Field | Type | Notes |
|---|---|---|
| `surface` | `startup` \| `in-browser` | `startup`: the entrypoint's Node helper writes a warning line to container stdout (visible via `docker logs`) for each missing required value. `in-browser`: `src/config.ts` consumers (`auth.ts`, `api.ts`) `console.warn` when a value they need resolves to empty, mirroring the existing `auth.ts` behavior today |
| `blocking` | `false` | Per FR-008/User Story 3, a missing value never crashes the container or blocks it from serving; only the dependent feature (e.g. sign-in) fails at the point it's used |

**Invariant**: The container process always starts and serves regardless of which (if any) required values are present — this holds for both runtime roles, since the entrypoint wraps both (research.md §5).
