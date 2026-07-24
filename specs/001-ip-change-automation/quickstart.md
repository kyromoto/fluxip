# Quickstart: Validating IP-Change-Triggered Automation

This is a validation/run guide, not an implementation guide — it proves the feature end-to-end against the contracts in `contracts/` and the acceptance scenarios in `spec.md`. Full request/response bodies and code live in the implementation, not here.

## Prerequisites

- Docker + Docker Compose
- A `docker-compose.yml` (created during implementation) bringing up: the FluxIP app container, Postgres, Redis, and Logto
- Environment variables set per `plan.md`'s Constraints (at minimum `CLOUDEVENTS_SOURCE`, `CLOUDEVENTS_TYPE_PREFIX`, `DEFAULT_IP_CLIENT_LIMIT`, Postgres/Redis/Logto connection strings) — no config files, env vars only
- A Hetzner DNS zone with an existing A/AAAA record you're willing to point at a test IP, and a **Hetzner Cloud API token** for it (issued from Hetzner Console; older DNS Console-issued tokens are not accepted — research.md §18, FR-035)
- `curl` (or any HTTP client) and a way to obtain a Logto access token for a test user (Logto's own login flow)

## Setup

```bash
docker compose up -d
# wait for app health check to pass
```

Register/log in as a test user via Logto to obtain an access token; export it for the steps below:

```bash
export TOKEN="<logto-access-token>"
```

## Scenario 1 — Automatic DNS update on IP change (validates User Story 1 / SC-001, SC-002)

1. Store a Provider Credential:
   `POST /api/provider-credentials` with your Hetzner Cloud API token.
2. Register an IP Client:
   `POST /api/ip-clients` — capture the returned reporting credential (shown once, per `contracts/management-api.md`).
3. Attach a DNS-Update Action to it:
   `POST /api/ip-clients/{id}/actions` referencing the stored credential, the Hetzner zone, record name, and `addressFamilies: ["ipv4"]`.
4. Simulate the router reporting a new IP, using the IP Client's own reporting credential as Basic Auth (per `contracts/trigger-endpoint.md`):
   ```bash
   curl -u "<ip_client_user>:<ip_client_secret>" \
     "http://localhost:PORT/nic/update?hostname=test&myip=203.0.113.42"
   ```
5. **Expected**: within the ~30s debounce window plus retry margin (well under SC-002's 5-minute target), `GET /api/actions/{id}/executions` shows one execution with `status: succeeded`, and the Hetzner DNS record now resolves to `203.0.113.42`.
6. Repeat step 4 with the same `myip` value.
   **Expected**: `GET /api/ip-clients/{id}/history` shows a new `ip_report_received` but no new `ip_changed`/execution (FR-006 no-op).

## Scenario 2 — Tenant isolation across two users (validates User Story 2 / SC-003)

1. Repeat Scenario 1's setup as a second, separate Logto-authenticated user (`TOKEN_B`).
2. As `TOKEN_B`, call `GET /api/ip-clients/{first-user's-id}` and `GET /api/provider-credentials`.
   **Expected**: `404` for the first user's IP Client ID; the credentials list contains only `TOKEN_B`'s own items — never a hint that the first user's resources exist.
3. As `TOKEN_B`, attempt `POST /api/ip-clients/{first-user's-id}/actions` referencing the first user's `providerCredentialId`.
   **Expected**: rejected (FR-013).

## Scenario 3 — Review, retry, and notification (validates User Story 3 / SC-006, SC-007)

1. Reconfigure the Action from Scenario 1 with an invalid `recordName` (`PUT /api/actions/{id}`), then repeat the trigger call from Scenario 1 step 4 with a new IP.
   **Expected**: `GET /api/actions/{id}/executions` shows a `failed` execution with an error message sufficient to identify the cause (SC-006), after the configured retry attempts (research.md §5) are exhausted.
2. Register a Notification Channel (`POST /api/notification-channel`) with a test email address (e.g., pointed at a local mail-catcher like MailHog in the compose stack), and set the IP Client's notification preference to `all` (`PUT /api/ip-clients/{id}/notification-preference`).
3. Fix the Action's `recordName` and repeat the trigger call.
   **Expected**: execution succeeds, and the test mailbox receives a notification within 1 minute (SC-007).
4. Manually re-run the Action (`POST /api/actions/{id}/run`).
   **Expected**: a new execution appears with `triggeredBy: "manual"`, using the IP Client's last known IP without requiring a new trigger call (FR-023).

## Scenario 4 — Horizontal scalability (validates SC-004)

1. Scale the app service to ≥2 replicas: `docker compose up -d --scale app=2`.
2. Fire ≥1,000 trigger calls (varying `myip` and/or IP Client) against the load-balanced endpoint, e.g. via a small load-generation script (implementation detail, not included here).
3. **Expected**: summing `action_execution.started`/`succeeded`/`failed` events across all IP Clients involved shows neither duplicate executions for the same settled IP change nor any missing ones — verifiable via the replay-count metrics from research.md §10 (`fluxip_replay_duration_seconds` / associated event-count counter) exposed at `/metrics`.

## Cleanup

```bash
docker compose down -v
```
