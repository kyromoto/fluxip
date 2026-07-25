# Quickstart: Validating Frontend Runtime Configuration

This is a validation/run guide, not an implementation guide — it proves the feature end-to-end against `contracts/docker-entrypoint.md`, `contracts/window-env.md`, and the acceptance scenarios in `spec.md`. Full script/Dockerfile/source code lives in the implementation (tasks.md), not here.

## Prerequisites

- Docker (the same root `Dockerfile` from `specs/002-docker-release-pipeline`, now with the entrypoint from this feature).
- A built image, e.g. `docker build -t fluxip:local .` from the repo root.

## Scenario 1 — Same image, two different deployments, no rebuild (validates User Story 1 / SC-001 / SC-002)

1. Start the image once with one set of values:
   ```bash
   docker run --rm -d -p 3000:3000 --name fluxip-frontend-a \
     -e FRONTEND_LOGTO_ENDPOINT=https://auth-a.example.com \
     -e FRONTEND_LOGTO_APP_ID=app-a \
     -e FRONTEND_LOGTO_API_RESOURCE=https://a.example.com/api \
     -e FRONTEND_BACKEND_URL=https://backend-a.example.com \
     fluxip:local serve --single frontend/dist -l 3000
   ```
2. Fetch the generated config: `curl -s http://localhost:3000/config.js`.
   **Expected**: contains `LOGTO_ENDPOINT` = `https://auth-a.example.com`, etc. — matching `contracts/window-env.md`'s shape.
3. Stop it (`docker stop fluxip-frontend-a`) and start the same image again with different values (`-b` deployment) on the same port.
4. Repeat the `curl /config.js` check.
   **Expected**: the response now reflects the `-b` values — no rebuild occurred between steps 1 and 3, only a restart with different env vars (SC-001/SC-002).

## Scenario 2 — Injection-safety of generated config (validates FR-007)

1. Start the image with a deliberately hostile value:
   ```bash
   docker run --rm -d -p 3000:3000 --name fluxip-frontend-inject \
     -e FRONTEND_LOGTO_ENDPOINT='</script><script>alert(1)</script>' \
     -e FRONTEND_LOGTO_APP_ID=x -e FRONTEND_LOGTO_API_RESOURCE=x -e FRONTEND_BACKEND_URL=x \
     fluxip:local serve --single frontend/dist -l 3000
   ```
2. `curl -s http://localhost:3000/config.js` and load `http://localhost:3000/` in a browser.
   **Expected**: the value appears as an inert, correctly-escaped JS string inside `window.__ENV__` (visible via the browser console: `window.__ENV__.LOGTO_ENDPOINT`) — no injected script executes.

## Scenario 3 — Deep-link SPA fallback still works under `--single` (validates User Story 2 / SC-003)

1. With a container running (any of the above), request a non-root in-app route directly: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/some/deep/route`.
   **Expected**: `200` (the SPA shell `index.html`, not a 404).
2. Request an existing static asset by its exact built filename (see `frontend/dist/assets/` after a build): `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/assets/<actual-hashed-filename>.js`.
   **Expected**: `200`, serving that exact file (not `index.html`).

## Scenario 4 — Missing required value is discoverable, container still serves (validates User Story 3 / SC-004)

1. Start the image with one required value omitted:
   ```bash
   docker run --rm -d -p 3000:3000 --name fluxip-frontend-missing \
     -e FRONTEND_LOGTO_ENDPOINT=https://auth.example.com \
     -e FRONTEND_LOGTO_APP_ID=app \
     -e FRONTEND_LOGTO_API_RESOURCE=https://example.com/api \
     fluxip:local serve --single frontend/dist -l 3000
     # FRONTEND_BACKEND_URL intentionally omitted
   ```
2. `docker logs fluxip-frontend-missing`.
   **Expected**: a warning line naming `FRONTEND_BACKEND_URL` as unset (contracts/docker-entrypoint.md step 1b) — discoverable without inspecting compiled JS (SC-004).
3. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/`.
   **Expected**: `200` — the container still serves despite the missing value (never a hard failure).

## Scenario 5 — Entrypoint doesn't affect the backend role (validates research.md §5)

1. Start the same image as the backend role, with no `FRONTEND_*` vars set at all (mirrors the existing CI smoke test):
   ```bash
   docker run --rm -d -p 8080:8080 --name fluxip-backend \
     -e DATABASE_URL=... -e REDIS_URL=... -e CLOUDEVENTS_SOURCE=... \
     -e CLOUDEVENTS_TYPE_PREFIX=... -e LOGTO_ENDPOINT=... -e CREDENTIAL_ENCRYPTION_KEY=... \
     fluxip:local node backend/dist/main.js
   ```
2. `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/metrics`.
   **Expected**: `200` — the backend starts and serves normally; the entrypoint's frontend-config step ran (harmlessly, with warnings in the logs) but did not block or alter backend startup.

## Cleanup

```bash
docker rm -f fluxip-frontend-a fluxip-frontend-inject fluxip-frontend-missing fluxip-backend 2>/dev/null || true
```
