# Quickstart: Validating Operational Logging & Traceability

## Prerequisites

- Repo already set up per the root `README.md` (`pnpm install`, `docker-compose up` for Postgres/Redis/Logto, `.env` populated).
- New env vars (all optional, see `contracts/config-env-vars.md`): `APP_LOG_LEVEL`, `ACCESS_LOG_FILE_PATH`, `ACCESS_LOG_MAX_SIZE_BYTES`, `ACCESS_LOG_MAX_FILES` — defaults are fine for local validation.
- `docker-compose.yml`'s `app` service now has a volume for the Access Log directory (see plan.md) — `docker-compose up` picks this up automatically; no manual step needed.

## Run the app

```bash
pnpm dev:backend
```

## Manual validation scenarios (map to spec.md User Stories)

1. **Trace a single operation end to end (User Story 1)** — Register an IP Client and a DNS-Update Action (or reuse existing ones), then send a request to `GET /nic/update` with a new IP. Watch stdout: confirm a "trigger report received" line appears immediately, then (~30s later, after the debounce window) an "IP change confirmed" line carrying a correlation id, followed by "execution enqueued" and "execution started"/"execution succeeded" (or "failed") lines all carrying that same correlation id. Grep stdout for that id and confirm every related line — and only those lines — comes back.
2. **Separate Access Log (User Story 2)** — While the above is happening, `tail -f logs/access.log` (or `ACCESS_LOG_FILE_PATH`) in a second terminal: confirm the `GET /nic/update` request appears there with method/path/status/response time/source IP, and confirm none of the stdout Application Log lines from Scenario 1 appear in this file.
3. **Streams never mix (User Story 3)** — With both terminals open from Scenarios 1–2, send a request with a deliberately invalid Trigger Device credential (`GET /nic/update` with a bad password) and confirm: it produces an Access Log entry (401) but no Application Log entry (FR-007), proving the two streams are independently populated even for a request that never reaches business logic.
4. **Secret redaction** — Create a Provider Credential via `POST /api/provider-credentials` with a recognizable fake token value; confirm that exact token string never appears in either stdout or `logs/access.log` at any point during or after the request.

## Automated checks

```bash
pnpm --filter fluxip-backend test tests/unit/observability/
pnpm --filter fluxip-backend test tests/integration/operation-traceability.test.ts
```

Expected outcomes: the unit test asserts category/sink separation and redaction behavior against `@logtape/testing`'s in-memory recorder; the integration test runs the real trigger→debounce→fan-out→execution pipeline and asserts every entry for one operation shares a correlation id (SC-001), a manual re-run's entries share a *different* id rooted at its own request, zero cross-stream contamination (SC-003), and zero plaintext secrets in any captured record (SC-004).

## What this quickstart does not cover

SC-007 (logging must not regress the existing <200ms p95 trigger-endpoint target) is validated by re-running `001-ip-change-automation`'s existing `tests/integration/trigger-performance.test.ts` after this feature lands and confirming the same threshold still holds — not a new test, but an existing one that must keep passing. SC-005 ("an operator can identify the reason for a failed execution using only its Application Log entry, in ≥90% of failure cases") is a qualitative/usability criterion best validated by an operator review pass over real failure logs, not something a single automated assertion can certify.
