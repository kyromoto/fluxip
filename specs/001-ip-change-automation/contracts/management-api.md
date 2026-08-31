# Contract: Management API

REST API used by the SolidJS frontend (and any future API consumer) to manage an account's resources. All endpoints below require a valid Logto-issued OIDC access token (`Authorization: Bearer <token>`), verified per research.md §7; the token's subject claim determines `accountId` for every request — no endpoint accepts a caller-supplied account identifier. Endpoints prefixed `/admin` additionally require an administrator role claim.

Response bodies below are illustrative field lists, not a full OpenAPI schema — exact shapes are finalized during implementation (tasks.md), referencing the fields defined in `data-model.md`.

## Account

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/account` | Read the caller's own account (device limit, status) | `404` if not yet registered in FluxIP's own store (first call auto-provisions the `account` aggregate from the verified token, per data-model.md) |
| `PUT /api/account/password` | Change the caller's password, in-app | Body: `{ newPassword }`. Proxied to Logto's Management API via an M2M client-credentials token (research.md §15); the value is never logged, persisted, or event-sourced by FluxIP itself |
| `DELETE /api/account` | Close the account | Immediate, permanent (FR-032) — response confirms before the hard-delete purge (research.md §12) completes; no undo |
| `POST /admin/accounts/{accountId}/device-limit` | Administrator overrides an account's IP Client limit | Body: `{ newLimit }`. Emits `account.device_limit_overridden` (FR-034) |

## IP Clients

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/ip-clients` | List the caller's IP Clients | Served from a Redis projection (research.md §9) |
| `POST /api/ip-clients` | Register a new IP Client | Body: `{ label }`. Rejected (`409`) if `deviceLimit` reached (FR-003). Response includes the plaintext reporting credential **once** (research.md §14) — the client must display/copy it immediately |
| `GET /api/ip-clients/{id}` | Get one IP Client's detail + status | |
| `POST /api/ip-clients/{id}/rotate-credential` | Rotate the reporting credential | Response includes the new plaintext credential once (FR-019) |
| `POST /api/ip-clients/{id}/enable` \| `/disable` | Toggle without deleting (FR-017) | |
| `DELETE /api/ip-clients/{id}` | Decommission | Irreversible (data-model.md `ip_client.decommissioned`) |
| `PUT /api/ip-clients/{id}/notification-preference` | Set per-client notification mode | Body: `{ preference: "off" \| "failures_only" \| "all" }` (FR-029) |
| `GET /api/ip-clients/{id}/history` | Paginated feed of `ip_changed` events + resulting `action_execution`s | Backs User Story 3 |

## Actions

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/ip-clients/{ipClientId}/actions` | List Actions attached to an IP Client | |
| `POST /api/ip-clients/{ipClientId}/actions` | Attach a new Action | Body: `{ type, addressFamilies, config }`; `config.providerCredentialId` must belong to the same account (`403` otherwise, FR-013) |
| `PUT /api/actions/{id}` | Reconfigure | Body: partial `{ addressFamilies?, config? }` |
| `POST /api/actions/{id}/enable` \| `/disable` | Toggle (FR-017) | |
| `DELETE /api/actions/{id}` | Detach | |
| `POST /api/actions/{id}/run` | Manually re-run using the IP Client's last known IP | FR-023; creates a new `action_execution` with `triggeredBy: "manual"` |
| `GET /api/actions/{id}/executions` | Paginated execution history for one Action | Each item's outcome/error mirrors `action_execution.succeeded`/`.failed` |

## Provider Credentials

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/provider-credentials` | List (label + provider only, never the secret) | |
| `POST /api/provider-credentials` | Store a new credential | Body: `{ provider, label, secret }`; `secret` is accepted once, encrypted at rest (data-model.md), never returned again |
| `POST /api/provider-credentials/{id}/rotate` | Replace the secret | Body: `{ secret }` |
| `DELETE /api/provider-credentials/{id}` | Revoke | Actions referencing it will fail on next execution, surfaced via execution history, not blocked at revoke time |

## Notification Channel

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/notification-channel` | Read the account's channel config, if any | `404` if none configured yet (opt-in, FR-028) |
| `POST /api/notification-channel` | Register (e.g., one or more email addresses) | Body: `{ type: "email", addresses: string[] }` |
| `PUT /api/notification-channel` | Reconfigure | Body: `{ addresses: string[] }` |
| `DELETE /api/notification-channel` | Revoke | Subsequent executions send no notifications regardless of per-IP-Client preference |

## Cross-cutting

- Every list/get endpoint scopes results to the caller's `accountId` at the query layer (research.md §8) — a request for another account's resource ID returns `404`, not `403`, to avoid confirming the resource's existence (supports FR-013/SC-003).
- All mutating endpoints are idempotent-safe to retry from the client's perspective in the sense that they map 1:1 to a single new event append; none accept a client-supplied event ID (that's an internal concern), so accidental double-submission from the UI is a UX concern (e.g. disable the submit button), not a data-integrity one.
