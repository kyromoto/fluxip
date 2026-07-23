# Quickstart: Validating Provider Credential Management

## Prerequisites

- Repo already set up per the root `README.md` (`pnpm install`, `docker-compose up` for Postgres/Redis/Logto, `.env` populated from `.env.example`, `CREDENTIAL_ENCRYPTION_KEY` set — this is the same key the existing `POST /provider-credentials` already uses).
- At least one authenticated account with one Trigger Device, so an Action can be attached during scenario 3 below.
- No new dependencies or setup beyond what 001/003 already require — this feature adds no package.

## Run the app

```bash
pnpm dev:frontend   # http://localhost:5173, proxies /api to the backend
pnpm dev:backend    # separate terminal
```

## Manual validation scenarios (map to spec.md User Stories)

1. **Create, view, delete in a dedicated area (User Story 1)** — Open the new "Credentials" nav link. From empty, use the `EmptyState` call-to-action to open `CredentialFormDialog`; choose "Hetzner API Token", enter a name (e.g. "Hetzner Hauptaccount") and a token value; confirm the new entry appears in the list showing its name, type, and only a masked value (e.g. `••••1234`) — never the value you typed. Confirm re-opening/reloading the page never reveals the full value anywhere (check the Network tab: no response body ever contains the full secret after the initial `201`). Delete the entry (not referenced by any Action yet) and confirm it disappears from the list.
2. **Select an existing credential in the Action wizard; no dead end when empty (User Story 2)** — With zero Hetzner credentials, start configuring a DNS-update Action on a Trigger Device and reach the credential step: confirm you're offered an inline "add a credential" affordance instead of an empty/dead dropdown, that completing it keeps you on the same wizard step with the new credential auto-selected, and that cancelling it leaves the wizard exactly as it was. With ≥2 named Hetzner credentials, confirm the dropdown lists both by their chosen names and either can be selected.
3. **Reuse across Actions; delete is blocked while referenced (User Story 3)** — Create two Hetzner credentials ("Hauptaccount", "Kundenprojekt X"). Configure Action A to use one and Action B to use the other; configure a third Action C to reuse "Hauptaccount". Confirm all three Actions save successfully. Attempt to delete "Hauptaccount" from the Credentials page and confirm it's rejected with a message naming the specific Actions (or their DNS targets) still using it (FR-010) — then detach/reconfigure those Actions away from it and confirm the delete now succeeds.

## Automated checks

```bash
pnpm --filter fluxip-backend test tests/contract/provider-credentials.test.ts
pnpm --filter fluxip-backend test tests/integration/provider-credential-lifecycle.test.ts
pnpm --filter fluxip-frontend test credentials-page dns-target-step
npx playwright test action-wizard.spec.ts   # extended with the empty-credentials → inline create path
```

Expected outcomes: the contract test rejects a duplicate (case-insensitive) `label` with `409`, and confirms no response body at any point after creation contains more than `secretLast4`; the integration test proves the full create → attach → delete-blocked (`409` + `usedBy` naming the Action) → detach → delete-succeeds lifecycle end-to-end against real Postgres; the frontend unit tests cover the empty-state inline dialog and the standalone Credentials page's create/delete/error-rendering paths; the Playwright addition proves a user can complete the Action wizard from zero credentials without leaving it.

## What this quickstart does not cover

SC-001 ("under 1 minute" to create and see a masked credential) is a timed usability criterion, not something an automated test asserts — track it via a manual timing pass alongside 003's existing usability-criteria tracking, not via `pnpm test`/`playwright test`.
