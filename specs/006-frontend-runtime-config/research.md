# Phase 0 Research: Frontend Runtime Configuration

## §1. Safe generation of `config.js`

**Decision**: The entrypoint generates `config.js` using a small Node.js script (`frontend/scripts/generate-runtime-config.mjs`), not inline shell string interpolation. It builds a plain object from the `FRONTEND_*` env vars and writes `window.__ENV__ = ${JSON.stringify(configObject)};` to `frontend/dist/config.js`.

**Rationale**: FR-007 requires the generated file to be immune to injection from env var values containing quotes, backslashes, or HTML-special characters. `JSON.stringify` correctly escapes all of these for safe embedding inside a `<script>` (non-JSON-context) body, and the runtime image already ships Node.js 22 (it's the backend's runtime), so no new dependency or interpreter is introduced. Hand-rolled shell escaping (e.g. `sed`/`printf` with manual quote-escaping) is a well-known source of injection bugs and was rejected for that reason.

**Alternatives considered**:
- Pure shell (`envsubst`/`sed` templating): rejected — correctly escaping arbitrary env var content for safe JS/HTML embedding in POSIX shell is error-prone and exactly the risk FR-007 calls out.
- A templating library (e.g. Mustache/Handlebars): rejected — adds a dependency for a one-object JSON dump that `JSON.stringify` already does correctly.

## §2. Environment variable naming

**Decision**: Frontend runtime values are named with an explicit `FRONTEND_` prefix: `FRONTEND_LOGTO_ENDPOINT`, `FRONTEND_LOGTO_APP_ID`, `FRONTEND_LOGTO_API_RESOURCE`, `FRONTEND_BACKEND_URL`. The `window.__ENV__` object itself uses the shorter, unprefixed keys (`LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_API_RESOURCE`, `BACKEND_URL`) since it's already frontend-scoped by construction.

**Rationale**: The backend already owns `BACKEND_LOGTO_ENDPOINT` and `BACKEND_LOGTO_APP_ID` (`backend/src/config/env.ts`) for a different purpose (server-side JWT verification / Management API client), with different required-ness and different values (the frontend's Logto App ID is a public SPA client; the backend's is an optional confidential Management API client). Both services are expected to share one `.env` file in `docker-compose.yml` (research.md §6), so unprefixed names would collide. Prefixing the frontend's copies avoids that collision and makes the ownership unambiguous at a glance in `.env`/`.env.example`.

**Alternatives considered**:
- Reuse the exact `VITE_LOGTO_*` names as runtime env var names too: rejected — keeping the `VITE_` prefix on a var that Vite no longer reads at runtime would be misleading, and it still collides with the backend's `BACKEND_LOGTO_ENDPOINT`.

## §3. Local dev fallback (`src/config.ts`)

**Decision**: A single new module, `frontend/src/config.ts`, centralizes every deployment-specific read: for each value it returns `window.__ENV__?.<KEY>` if defined and non-empty, otherwise falls back to the corresponding `import.meta.env.VITE_*`. `src/services/auth.ts` and `src/services/api.ts` are updated to read through this module instead of `import.meta.env` directly.

**Rationale**: FR-011 (clarified) scopes the runtime mechanism to the Docker image only; local dev (`vite dev`) must keep working unchanged. Since `vite dev` never runs the entrypoint script, `window.__ENV__` is either absent or the empty placeholder (research.md §4) in dev, so the fallback transparently preserves today's `.env`-based dev workflow with no special-casing in application code beyond this one accessor module.

**Alternatives considered**:
- Two separate code paths (`if (import.meta.env.DEV) ... else ...`): rejected — a value-by-value fallback is simpler and doesn't need to know which mode it's running in; it degrades correctly by construction (an unset `window.__ENV__` key is just falsy).

## §4. `frontend/public/config.js` placeholder

**Decision**: Commit an empty placeholder at `frontend/public/config.js` containing `window.__ENV__ = {};`. Vite's `public/` directory is copied verbatim into `dist/` by `vite build` (and served as-is by `vite dev`), so this file exists at `/config.js` in both dev and prod *before* the entrypoint ever runs.

**Rationale**: Without this file, `vite dev` would 404 on the `<script src="/config.js?...">` tag added to `index.html` (harmless, but a needless console error on every dev page load). With the placeholder, `window.__ENV__` is always a defined (possibly empty) object, so `src/config.ts`'s per-key fallback (research.md §3) behaves uniformly instead of needing to guard against `window.__ENV__` being `undefined` entirely. In the built image, the entrypoint overwrites `dist/config.js` with the real values on every container start (FR-006); the placeholder only ever matters for local dev or a container's very first instant before the entrypoint's write completes.

**Alternatives considered**:
- No placeholder, guard every read with `window.__ENV__?.KEY`: rejected as strictly more defensive code for no behavioral gain, and it still leaves a 404 in the dev console.

## §5. Entrypoint applies to both runtime roles

**Decision**: `ENTRYPOINT ["/app/docker-entrypoint.sh"]` wraps *both* the `backend` and `frontend` roles' start commands (`docker-compose.yml`'s `command:` becomes the entrypoint's `"$@"`), since `specs/002-docker-release-pipeline` already established one shared image where the role is chosen purely by start command. The entrypoint always attempts to regenerate `frontend/dist/config.js` (guarded by `[ -d /app/frontend/dist ]`, which is always true in this image) regardless of which role is about to start, and never fails the container start if a `FRONTEND_*` value is missing — it only warns (FR-008/User Story 3).

**Rationale**: A role-aware entrypoint (skip config generation for the backend role) would need to know the role in advance, which today is implicit in the start command, not an explicit signal the entrypoint receives — adding one would be a bigger change than just doing the (cheap, side-effect-free-for-the-backend-role) config regeneration unconditionally. Never hard-failing on missing `FRONTEND_*` values is required anyway so the *existing* backend smoke test in `release.yml` (which starts the image with `node backend/dist/main.js` and no `FRONTEND_*` vars set) keeps working unmodified.

**Alternatives considered**:
- A per-role entrypoint script selected via a build ARG or separate image stage: rejected — reintroduces the two-image-variant problem `specs/002-docker-release-pipeline` deliberately eliminated.

## §6. Cache-busting mechanism (FR-010)

**Decision**: `index.html` ships with a literal placeholder token in the config script tag: `<script src="/config.js?v=__CONFIG_VERSION__"></script>`. On every container start, the Node helper (research.md §1) does a literal string replacement of `__CONFIG_VERSION__` in `frontend/dist/index.html` with a fresh value (current timestamp), in addition to writing `config.js`.

**Rationale**: A cached `config.js` response can only be bypassed by requesting a different URL. Since `index.html` itself is what names that URL, and every fresh page load fetches `index.html` (browsers don't long-cache navigations by default the way they do static assets), rewriting the query token there on each restart is what makes a *new* page load after a restart fetch the *new* `config.js`, satisfying SC-002/FR-010 as clarified: a tab left open from before the restart isn't required to update until reloaded, since it already has the old `index.html` (and thus the old `config.js` URL) in memory. A literal string replace (not a regex parse of arbitrary HTML) was chosen because the token is a fixed, unique marker the entrypoint fully controls — no HTML parsing risk.

**Alternatives considered**:
- `Cache-Control: no-store` on `config.js` specifically (e.g. via a `serve.json` config): rejected per the clarification — the user explicitly chose "caching allowed, cache-busting on restart" over "config must never be cached".
- Content-hash the generated file (like Vite does for bundle assets): rejected as unnecessary complexity — a per-container-start timestamp is sufficient to guarantee uniqueness across restarts, and content-addressing would require hashing after every write instead of one timestamp computed once at start.

## §7. `serve -s` → `serve --single`

**Decision**: Every place the `frontend` role's start command is defined (`docker-compose.yml`, `.github/workflows/release.yml`'s smoke test, `README.md`'s example `docker run` commands) changes the flag from `-s` to `--single`.

**Rationale**: `-s` and `--single` are the same `serve` CLI flag (SPA fallback mode) — this is a literal, explicitly requested rename with no behavioral change, kept in scope because the request calls it out by name (FR-005/User Story 2 must keep passing under the new flag spelling).

**Alternatives considered**: N/A — this is a direct instruction, not a design choice.

## §8. Backend URL is now always required (no same-origin default)

**Decision**: `frontend/src/services/api.ts` prefixes every request with the configured `BACKEND_URL` (from `src/config.ts`) instead of assuming a same-origin relative `/api` path. In production (Docker), `FRONTEND_BACKEND_URL` must be set explicitly (clarified: no implicit default). In local dev, the `import.meta.env.VITE_BACKEND_URL` fallback defaults to an empty string when unset, preserving today's zero-config dev experience (Vite's existing `/api` proxy in `vite.config.ts` already forwards same-origin, unaffected by this feature — research.md §3/§4 scope the runtime mechanism to Docker only).

**Rationale**: Directly implements the clarification answer recorded in spec.md (backend location is always a required runtime value, no same-origin fallback default) while keeping local dev's existing proxy-based workflow (which was explicitly ruled out of scope) working exactly as before.
