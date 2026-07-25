# Contract: Docker Entrypoint

The interface operators depend on to configure a running container (FR-001), and the interface the two runtime roles (`backend`, `frontend` — established in `specs/002-docker-release-pipeline`) depend on for how they get started.

## Environment variables

| Variable | Required | Default when unset | Consumed by |
|---|---|---|---|
| `FRONTEND_LOGTO_ENDPOINT` | Yes (production) | none — empty in `window.__ENV__`, triggers Runtime Config Warning | `config.js` generation |
| `FRONTEND_LOGTO_APP_ID` | Yes (production) | none — same as above | `config.js` generation |
| `FRONTEND_LOGTO_API_RESOURCE` | Yes (production) | none — same as above | `config.js` generation |
| `FRONTEND_BACKEND_URL` | Yes (production) | none — same as above | `config.js` generation |

None of these are read by the `backend` role's process — they are exclusively consumed by the entrypoint's config-generation step, which runs unconditionally regardless of which role's start command follows it (research.md §5).

## Invocation contract

```text
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD is supplied by the caller (docker-compose `command:`, or a `docker run ... <image> <cmd>` argument), e.g.:
  node backend/dist/main.js
  serve --single frontend/dist -l 3000
```

Behavior, in order, on every container start regardless of the eventual `CMD`:

1. If `/app/frontend/dist` exists (always true in this image — both roles ship from the same build):
   a. Read the four `FRONTEND_*` variables from the process environment.
   b. For each that is unset or empty, write one warning line to stdout (e.g. `docker-entrypoint: FRONTEND_BACKEND_URL is not set — the frontend will be unable to reach the backend`).
   c. Write `/app/frontend/dist/config.js` as `window.__ENV__ = <JSON>;`, `<JSON>` being a safe `JSON.stringify` of whatever values *are* present (empty string for any that are not) — see `contracts/window-env.md`.
   d. Replace the `__CONFIG_VERSION__` token in `/app/frontend/dist/index.html` with a fresh timestamp (research.md §6).
2. `exec "$@"` — replace the entrypoint process with the supplied `CMD`, so the container's PID 1 and signal handling are unaffected by the entrypoint wrapper (standard Docker entrypoint pattern).

## Guarantees

- **Never blocks or fails container start**: step 1 never exits non-zero for a missing `FRONTEND_*` value; only a failure to *write* `config.js`/`index.html` (e.g. read-only filesystem) is a hard failure, since that would mean the image itself is misconfigured, not the deployment's env vars.
- **Idempotent per start**: running the same container image with the same env vars produces byte-identical `config.js` contents (modulo the cache-bust token, which is intentionally different every start — research.md §6).
- **Role-agnostic**: the same entrypoint script runs before both `node backend/dist/main.js` and `serve --single frontend/dist -l <port>` — this is what lets the existing backend-role smoke test (`.github/workflows/release.yml`, which sets no `FRONTEND_*` vars) keep passing unmodified (research.md §5).
