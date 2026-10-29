# Development

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
(cd agent && go test ./...)        # agent: renderer, atomic writes, offline timer, end-to-end against a scripted server
```

Backend tests are real integration tests against Postgres/Redis/BullMQ (Testcontainers-style — no mocked event store or queue), so `docker compose up -d postgres redis` (or equivalent) must be running first, with `BACKEND_DATABASE_URL`/`BACKEND_REDIS_URL` pointed at them. Test files run sequentially (`fileParallelism: false` in `vitest.config.ts`) since they register real BullMQ workers on the same production-named queues.

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
