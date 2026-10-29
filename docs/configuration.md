# Configuration

All configuration is via environment variables — no config files are baked into the image (12-factor). Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

## Backend

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
| `BACKEND_BIND_ADDRESS` | | `0.0.0.0` | Interface the HTTP and agent gRPC listeners bind to. |
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

## Frontend (container runtime)

Read only by the `frontend` role's container-start entrypoint (`docker-entrypoint.sh`), which regenerates `frontend/dist/config.js` — consumed by the app as `window.__ENV__` — on every container start, so the same built image can be redeployed with different values without a rebuild (`specs/006-frontend-runtime-config/`). A missing value is logged at container start and warned about in the browser console rather than failing the container.

| Name | Required | Default | Description |
|---|---|---|---|
| `FRONTEND_LOGTO_ENDPOINT` | X | | Logto OIDC issuer endpoint the frontend's `@logto/browser` client connects to. |
| `FRONTEND_LOGTO_APP_ID` | X | | Logto SPA application ID (distinct from `BACKEND_LOGTO_APP_ID`, a different Logto application). |
| `FRONTEND_LOGTO_API_RESOURCE` | X | | API resource indicator requested so Logto issues a signed JWT rather than an opaque token. |
| `FRONTEND_BACKEND_URL` | X | | Backend URL prefixed onto every frontend API request. |

## Frontend (local `vite dev` only)

Build-time fallbacks read by `frontend/src/config.ts` when `window.__ENV__` isn't present (i.e. `vite dev`, never in Docker) — irrelevant to a container deployment.

| Name | Required | Default | Description |
|---|---|---|---|
| `VITE_LOGTO_ENDPOINT` | | | Local dev fallback for `FRONTEND_LOGTO_ENDPOINT`. |
| `VITE_LOGTO_APP_ID` | | | Local dev fallback for `FRONTEND_LOGTO_APP_ID`. |
| `VITE_LOGTO_API_RESOURCE` | | | Local dev fallback for `FRONTEND_LOGTO_API_RESOURCE`. |
| `VITE_BACKEND_URL` | | | Local dev fallback for `FRONTEND_BACKEND_URL`. |

