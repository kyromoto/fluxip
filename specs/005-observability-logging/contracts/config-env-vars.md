# Contract: New Environment Variables

Follows the existing `backend/src/config/env.ts` pattern (`requireString`/`optionalString`/`optionalInt`). All four are optional with sane defaults — nothing about this feature requires new required configuration, consistent with the spec's non-goal of not mandating a specific destination/tool decision beyond what the user already specified (console for app, rotating file for access).

| Env var | Type | Default | Meaning |
|---|---|---|---|
| `BACKEND_APP_LOG_LEVEL` | string | `"info"` | Lowest LogTape level recorded for the `["fluxip","app"]` category tree (`"debug"` \| `"info"` \| `"warning"` \| `"error"` \| `"fatal"`) |
| `BACKEND_ACCESS_LOG_FILE_PATH` | string | `"logs/access.log"` | Path the rotating Access Log file is written to (relative to the backend process's working directory inside the container) |
| `BACKEND_ACCESS_LOG_MAX_SIZE_BYTES` | integer | `10485760` (10 MiB) | `getRotatingFileSink`'s `maxSize` — triggers rotation once exceeded |
| `BACKEND_ACCESS_LOG_MAX_FILES` | integer | `5` | `getRotatingFileSink`'s `maxFiles` — number of rotated files retained (`.1`…`.5`) before the oldest is discarded |

## Docker/deployment consequence

`docker-compose.yml`'s `app` service gains a named volume mounted at the directory containing `BACKEND_ACCESS_LOG_FILE_PATH` (default `logs/`), so the rotating file and its rotated siblings survive container restarts — today that service has no volumes at all. `.env.example` documents all four variables alongside the existing entries.
