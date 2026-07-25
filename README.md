# FluxIP

FluxIP triggers configurable actions — starting with updating a Hetzner DNS record — when a registered Trigger Device (e.g. a FritzBox router) reports a public IP change via a DynDNS-compatible endpoint. It is a multi-tenant, event-sourced system: every state change is an immutable event in Postgres, Redis holds only disposable read models, and BullMQ handles the debounce/fan-out/retry pipeline so multiple app instances can process events in parallel without double-processing.

See `specs/001-ip-change-automation/` for the full spec (`spec.md`), architecture decisions (`research.md`, `data-model.md`, `contracts/`), and `quickstart.md` for the scenario-by-scenario validation guide this README summarizes.

## Architecture at a glance

- **Backend**: TypeScript/Node.js 22, [Hono](https://hono.dev/) web framework, pragmatic hexagonal architecture (ports only where a real second implementation is imminent: event store, action executors, notification channels).
- **Event store**: PostgreSQL, append-only `events` table — source of truth for every aggregate (`account`, `ip_client`, `action`, `action_execution`, `provider_credential`, `notification_channel`).
- **Async pipeline**: BullMQ (Redis-backed) — a 30s debounce window per IP Client absorbs flapping, then fans out one execution job per enabled Action with deterministic, idempotent job IDs.
- **Projections**: Redis read models (device lists, execution history) — always rebuildable from Postgres, never consulted for business decisions.
- **Auth**: [Logto](https://logto.io/) as the OIDC identity provider — FluxIP verifies JWTs via JWKS and never stores a password. In-app password change/account deletion are proxied to Logto's Management API.
- **Frontend**: SolidJS + Vite, styled with Tailwind CSS and [Kobalte](https://kobalte.dev/)/[Solid UI](https://www.solid-ui.com/) components (copied into the repo, not installed as a library) — auto dark/light via Tailwind's `media` strategy, no manual toggle. Account onboarding, Trigger Device creation, and Action configuration are guided multi-step flows; everything else stays a direct, single-step view. See `specs/003-end-user-ui-redesign/` for the full spec/plan/research.
- **Metrics**: Prometheus-compatible `/metrics`, including per-aggregate replay duration/event-count histograms (`fluxip_replay_duration_seconds`, `fluxip_replay_events_total`), so aggregates that get slower to replay over time are visible before snapshotting is ever needed.

## Prerequisites

- Docker + Docker Compose
- [pnpm](https://pnpm.io/) (via `corepack enable`) for local (non-Docker) development
- A Hetzner DNS zone with an existing A/AAAA record, and a Hetzner **Cloud API** token for it (for the DNS-Update Action) — tokens issued by the older, separate DNS Console/API are not accepted (FR-035)

## Configuration

All configuration is via environment variables — no config files are baked into the image (12-factor). Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

### Backend

Read by `backend/src/config/env.ts` (`loadConfig()`) — a missing "Yes" var throws at startup, before the port ever opens.

| Name | Required | Default | Description |
|---|---|---|---|
| `BACKEND_CLOUDEVENTS_SOURCE` | X | | CloudEvents `source` field for every domain event envelope (research.md §3). |
| `BACKEND_CLOUDEVENTS_TYPE_PREFIX` | X | | CloudEvents `type` prefix, assembled as `${PREFIX}.<aggregate>.<event>`. |
| `BACKEND_DATABASE_URL` | X | | Postgres connection string (event store). |
| `BACKEND_REDIS_URL` | X | | Redis connection string (BullMQ + projections). |
| `BACKEND_LOGTO_ENDPOINT` | X | | Logto OIDC issuer endpoint used for JWT verification. |
| `BACKEND_CREDENTIAL_ENCRYPTION_KEY` | X | | 32-byte, base64-encoded key (`openssl rand -base64 32`) that encrypts Provider Credential secrets (e.g. Hetzner Cloud API tokens) at rest (AES-256-GCM). IP Client reporting credentials are never encrypted or logged — they're always system-generated and only a salted hash is ever persisted. |
| `BACKEND_DEFAULT_IP_CLIENT_LIMIT` | | `5` | Default per-account IP Client device limit (FR-033). |
| `BACKEND_ACTION_RETRY_ATTEMPTS` | | `5` | BullMQ retry attempts for a failed Action execution. |
| `BACKEND_ACTION_RETRY_BASE_DELAY_MS` | | `30000` | Base delay (ms) for exponential retry backoff. |
| `BACKEND_IP_CLIENT_DEBOUNCE_MS` | | `30000` | Debounce window (ms) absorbing IP-flapping before an Action fires. |
| `BACKEND_LOGTO_APP_ID` | | | Logto application ID for the backend's own (optional) Logto app — distinct from the frontend's `FRONTEND_LOGTO_APP_ID`. |
| `BACKEND_LOGTO_APP_SECRET` | | | Logto application secret matching `BACKEND_LOGTO_APP_ID`. |
| `BACKEND_LOGTO_MANAGEMENT_CLIENT_ID` | | | Client ID of the machine-to-machine Logto app used to proxy in-app password changes via the Management API. |
| `BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET` | | | Client secret matching `BACKEND_LOGTO_MANAGEMENT_CLIENT_ID`. |
| `BACKEND_LOGTO_MANAGEMENT_API_BASE_URL` | | | Base URL of Logto's Management API. |
| `BACKEND_PORT` | | `8080` | HTTP port the backend listens on. |
| `BACKEND_SMTP_HOST` | | `localhost` | Outbound SMTP relay host for account notifications. |
| `BACKEND_SMTP_PORT` | | `1025` | SMTP relay port. |
| `BACKEND_SMTP_USER` | | | SMTP auth username. |
| `BACKEND_SMTP_PASSWORD` | | | SMTP auth password. |
| `BACKEND_SMTP_SECURE` | | `false` | Use implicit TLS for the SMTP connection. |
| `BACKEND_NOTIFICATION_FROM_ADDRESS` | | `fluxip@localhost` | `From` address for outbound notification emails. |
| `BACKEND_APP_LOG_LEVEL` | | `info` | Lowest level recorded for the Application Log (stdout): `debug`\|`info`\|`warning`\|`error`\|`fatal`. |
| `BACKEND_ACCESS_LOG_FILE_PATH` | | `logs/access.log` | Rotating Access Log file path, relative to the backend process's working directory. |
| `BACKEND_ACCESS_LOG_MAX_SIZE_BYTES` | | `10485760` | Rotate the Access Log once it exceeds this size (bytes). |
| `BACKEND_ACCESS_LOG_MAX_FILES` | | `5` | Number of rotated Access Log files retained before the oldest is discarded. |

### Frontend (container runtime)

Read only by the `frontend` role's container-start entrypoint (`docker-entrypoint.sh`), which regenerates `frontend/dist/config.js` — consumed by the app as `window.__ENV__` — on every container start, so the same built image can be redeployed with different values without a rebuild (`specs/006-frontend-runtime-config/`). A missing value is logged at container start and warned about in the browser console rather than failing the container.

| Name | Required | Default | Description |
|---|---|---|---|
| `FRONTEND_LOGTO_ENDPOINT` | X | | Logto OIDC issuer endpoint the frontend's `@logto/browser` client connects to. |
| `FRONTEND_LOGTO_APP_ID` | X | | Logto SPA application ID (distinct from `BACKEND_LOGTO_APP_ID`, a different Logto application). |
| `FRONTEND_LOGTO_API_RESOURCE` | X | | API resource indicator requested so Logto issues a signed JWT rather than an opaque token. |
| `FRONTEND_BACKEND_URL` | X | | Backend URL prefixed onto every frontend API request. |

### Frontend (local `vite dev` only)

Build-time fallbacks read by `frontend/src/config.ts` when `window.__ENV__` isn't present (i.e. `vite dev`, never in Docker) — irrelevant to a container deployment.

| Name | Required | Default | Description |
|---|---|---|---|
| `VITE_LOGTO_ENDPOINT` | | | Local dev fallback for `FRONTEND_LOGTO_ENDPOINT`. |
| `VITE_LOGTO_APP_ID` | | | Local dev fallback for `FRONTEND_LOGTO_APP_ID`. |
| `VITE_LOGTO_API_RESOURCE` | | | Local dev fallback for `FRONTEND_LOGTO_API_RESOURCE`. |
| `VITE_BACKEND_URL` | | | Local dev fallback for `FRONTEND_BACKEND_URL`. |

## Running with Docker Compose

```bash
docker compose up -d
```

This brings up Postgres, Redis, Logto, the backend (`app`), and the frontend as separate containers. The backend runs its own Postgres migrations on startup.

Both `app` and `frontend` build from the same root [`Dockerfile`](Dockerfile) — see [Release process](#release-process) below for why there's only one image.

## Local development (without Docker for the app itself)

```bash
pnpm install
docker compose up -d postgres redis logto   # infra only
pnpm run dev:backend                         # backend on :8080 (tsx watch)
pnpm run dev:frontend                        # frontend on :5173 (Vite dev server)
```

## Testing

```bash
pnpm --filter fluxip-backend test
```

Backend tests are real integration tests against Postgres/Redis/BullMQ (Testcontainers-style — no mocked event store or queue), so `docker compose up -d postgres redis` (or equivalent) must be running first, with `BACKEND_DATABASE_URL`/`BACKEND_REDIS_URL` pointed at them. Test files run sequentially (`fileParallelism: false` in `vitest.config.ts`) since they register real BullMQ workers on the same production-named queues.

## Validating the feature end-to-end

`specs/001-ip-change-automation/quickstart.md` walks through all four acceptance scenarios (core DNS-update loop, tenant isolation, review/retry/notify, horizontal scale) against a running stack. The equivalent automated coverage lives in `backend/tests/integration/`.

## Release process

Every push to `main` runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds and tests the project, builds **one** Docker image containing both the backend and frontend, smoke-tests both runtime roles from that image, and — if a commit since the last release qualifies — publishes the image and cuts a version automatically. There are no manual version bumps and no manual `docker build`/`push`.

**Versioning**: the next version is computed from [Conventional Commits](https://www.conventionalcommits.org/) prefixes on commits since the last release tag, via `semantic-release`'s commit analyzer (config: [`.releaserc.json`](.releaserc.json)):

| Commit prefix | Bump |
|---|---|
| `fix:` | patch (`0.1.0` → `0.1.1`) |
| `feat:` | minor (`0.1.0` → `0.2.0`) |
| `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer | major (`0.1.0` → `1.0.0`) |
| anything else (`chore:`, `docs:`, no prefix, ...) | no release |

**One image, two runtime roles**: the published image (`ghcr.io/<owner>/fluxip`) contains both the backend and the frontend's static build. Which one runs is chosen entirely by the container's start command, not by a different image or tag — see `docker-compose.yml`'s `app` (`command: ["node", "backend/dist/main.js"]`) and `frontend` (`command: ["serve", "--single", "frontend/dist", "-l", "3000"]`) services. The same pattern works against the published image directly:

```bash
docker run --env-file .env -p 8080:8080 ghcr.io/<owner>/fluxip:<version> node backend/dist/main.js
docker run -p 3000:3000 ghcr.io/<owner>/fluxip:<version> serve --single frontend/dist -l 3000
```

A repo-root `docker-entrypoint.sh` runs before either start command and regenerates the frontend's runtime `config.js` from the `FRONTEND_*` env vars on every container start — see `specs/006-frontend-runtime-config/`.

**Where to find things**: published image tags and `:latest` are under `ghcr.io/<owner>/fluxip` (GitHub Container Registry, repository Packages tab); each release also gets a matching Git tag (`vX.Y.Z`) and GitHub Release. A version's Git tag is only ever created after that version's image has already published successfully — never before, never independently.

**Safety**: a push that fails the build, the tests, the Docker build, or either role's smoke test never publishes anything — the job simply fails at that step. A push with no qualifying commit still runs the full build/test/smoke-test pipeline (so regressions are still caught) but publishes nothing.

**One-time setup**: before the pipeline's first real run, seed a baseline tag so version computation has something to bump from (`semantic-release` otherwise starts from `1.0.0`, not this project's `0.1.0` baseline):

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Project structure

```
backend/    Hono API, event-sourced domain model, BullMQ workers, adapters (Postgres, Logto, Hetzner DNS, email)
frontend/   SolidJS UI (devices, actions, execution history, notifications, account settings) — Tailwind/Kobalte/Solid UI, guided wizards for onboarding/device/action setup
specs/      Spec-Kit artifacts: spec, plan, research, data model, contracts, tasks
deploy/     Deployment-time assets (e.g. Postgres init scripts for the Logto database)
```
