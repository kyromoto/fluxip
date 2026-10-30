# Development

## Local development (without Docker for the app itself)

```bash
pnpm install
docker compose up -d postgres redis logto   # infra only
pnpm --filter fluxip-backend cli migrate     # once, and after every pull that adds a migration
pnpm run dev:backend                         # backend on :8080 (tsx watch)
pnpm run dev:frontend                        # frontend on :5173 (Vite dev server)
```

## Admin CLI

The backend ships a small CLI for one-off admin tasks (`backend/src/cli.ts`). In the image it is `node backend/dist/cli.js <command>`, in the workspace `pnpm --filter fluxip-backend cli <command>`.

| Command | Purpose |
|---|---|
| `migrate` | Applies pending database migrations without starting the app. Needs only `BACKEND_DATABASE_URL`. Safe to run from several processes at once (Postgres advisory lock): the others wait and find nothing left to do. |
| `validate-config [--online]` | Checks the environment before a deploy and lists every problem at once, never printing a value. `--online` also checks that Postgres, Redis and Logto answer (5 s limit each). Warnings (development defaults for email, missing management credentials, no public agent URL) do not change the exit code. |

Exit codes: `0` ok, `1` the check or migration failed, `2` usage error. `help` lists the commands and needs no configuration.

The web process does not migrate any more. It checks the schema on start and stops with `Database schema is outdated … Run: node backend/dist/cli.js migrate` if migrations are pending. In Docker Compose the one-off `migrate` service runs first; elsewhere (an orchestrator, `docker run`) make `migrate` a release step before the new version starts. A `migrate` run that waits on the lock behind a crashed process stays blocked until Postgres drops that connection (TCP timeout).

`app` and `frontend` have Compose healthchecks (`/readyz`, `/`). `/readyz` answers 503 while Postgres or Redis is unreachable, so `app` turns unhealthy and recovers on its own. The check calls `127.0.0.1`; if you set `BACKEND_BIND_ADDRESS` to a specific address, adjust the check in `docker-compose.yml`.

## Testing

```bash
pnpm --filter fluxip-backend test
(cd agent && go test ./...)        # agent: renderer, atomic writes, offline timer, end-to-end against a scripted server
```

Backend tests are real integration tests against Postgres/Redis/BullMQ (Testcontainers-style — no mocked event store or queue), so `docker compose up -d postgres redis` (or equivalent) must be running first, with `BACKEND_DATABASE_URL`/`BACKEND_REDIS_URL` pointed at them. Test files run sequentially (`fileParallelism: false` in `vitest.config.ts`) since they register real BullMQ workers on the same production-named queues.

## UI conventions

The web UI follows Principle III of the [constitution](../.specify/memory/constitution.md) (desktop and mobile). The rules live in shared components, so pages use them instead of re-implementing them:

- `PageHeader` (`frontend/src/components/layout/`): screen-reader heading plus the slot for the page's primary action. There is no visible page title; the breadcrumb (and the tab bar on device pages) names the page.
- `PrimaryAction`: the one primary action per page. Top right from 768px up, a floating button at the bottom right below that.
- `CardActions` (`components/ui/`): safe actions on the left, destructive ones (`variant="destructive"`) on the right, 12px apart.
- `NavTabs` / `DeviceLayout`: link-based tab bar for a device's Actions, History and Settings.
- Touch targets: below 768px every interactive element is at least 44x44px. `Button` and the other `components/ui` primitives do this already; use the `.touch-target` utility (`app.css`) for plain links.

`pnpm --filter fluxip-frontend test:e2e` checks placement and touch-target sizes. It needs a signed-in session, see `frontend/tests/e2e/README.md`.

## Validating the feature end-to-end

`specs/001-ip-change-automation/quickstart.md` walks through all four acceptance scenarios (core DNS-update loop, tenant isolation, review/retry/notify, horizontal scale) against a running stack. The equivalent automated coverage lives in `backend/tests/integration/`.

## Project structure

```
agent/      Go agent for Traefik hosts (templates → atomic files), shares only proto/ with the backend
proto/      Agent session protocol (.proto), the one contract shared between backend and agent
backend/    Hono API, event-sourced domain model, BullMQ workers, adapters (Postgres, Logto, Hetzner DNS, email)
frontend/   SolidJS UI (devices, actions, execution history, notifications, account settings) — Tailwind/Kobalte/Solid UI, guided wizards for onboarding/device/action setup
specs/      Spec-Kit artifacts: spec, plan, research, data model, contracts, tasks
deploy/     Deployment-time assets (e.g. Postgres init scripts for the Logto database)
```
