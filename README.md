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

Notably:

- `CLOUDEVENTS_SOURCE` / `CLOUDEVENTS_TYPE_PREFIX` — required, no hardcoded defaults (every event's CloudEvents envelope is built from these).
- `CREDENTIAL_ENCRYPTION_KEY` — a 32-byte, base64-encoded key (`openssl rand -base64 32`) used to encrypt Provider Credential secrets (e.g. Hetzner Cloud API tokens) at rest. IP Client reporting credentials are never encrypted or logged — they're always system-generated and only a salted hash is ever persisted.
- `LOGTO_ENDPOINT`, `LOGTO_MANAGEMENT_CLIENT_ID`/`_SECRET`/`_API_BASE_URL` — Logto OIDC + Management API (for in-app password change).
- `SMTP_*` / `NOTIFICATION_FROM_ADDRESS` — outbound email for optional per-account notifications.
- `FRONTEND_LOGTO_ENDPOINT`/`_APP_ID`/`_API_RESOURCE`, `FRONTEND_BACKEND_URL` — read by the `frontend` container's entrypoint at startup (not the backend) to generate a runtime `config.js` the frontend reads via `window.__ENV__`, so the same built image can be redeployed with different values without a rebuild — see `specs/006-frontend-runtime-config/`. All four are required for a working deployment; a missing one is logged at container start and warned about in the browser console rather than failing the container.

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

Backend tests are real integration tests against Postgres/Redis/BullMQ (Testcontainers-style — no mocked event store or queue), so `docker compose up -d postgres redis` (or equivalent) must be running first, with `DATABASE_URL`/`REDIS_URL` pointed at them. Test files run sequentially (`fileParallelism: false` in `vitest.config.ts`) since they register real BullMQ workers on the same production-named queues.

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
