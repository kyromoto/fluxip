# Quickstart: Validating the Hetzner Cloud Firewall Rule Action

## Prerequisites

- Repo already set up per the root `README.md` (`pnpm install`, `docker-compose up` for Postgres/Redis/Logto, `.env` populated).
- A Hetzner Cloud project with a Firewall that has at least one rule you can freely edit for testing, and a Hetzner Cloud API token with read/write access to it.
- At least one authenticated FluxIP account with one Trigger Device, and a Hetzner Provider Credential already stored (created the same way an existing DNS Action's credential is — no new credential type).
- No new infrastructure dependency: this feature adds no package and no new datastore, only reusing the existing Postgres event store and Redis (BullMQ queue + the new advisory lock, research.md §2).

## Run the app

```bash
pnpm dev:frontend   # http://localhost:5173, proxies /api to the backend
pnpm dev:backend    # separate terminal
```

## Manual validation scenarios (map to spec.md User Stories)

1. **Keep a rule pointed at the device's current IP (User Story 1)** — In the Action wizard, choose "Hetzner Cloud Firewall Rule Update", select the Hetzner credential, and enter the target firewall's ID plus the rule selector (direction/protocol/port/description) for a rule you can inspect in the Hetzner Console. Confirm the Action is only created once the selector matches exactly one rule (try a typo'd description first — confirm it's rejected before the Action exists, per FR-018). Trigger an IP change on the Trigger Device (or use manual re-run) and confirm the rule's address list in the Hetzner Console now contains the new address. Trigger a second change and confirm the rule contains only the new address, not both.
2. **Other entries are never touched (User Story 2)** — Manually add an unrelated static CIDR to the same rule in the Hetzner Console. Trigger two more IP changes through the Action. Confirm the static entry is still present and unchanged after both, and that a second Action (pointed at the same rule from a different Trigger Device) keeps its own entry independent of the first.
3. **Choose address families (User Story 3)** — Configure an Action for IPv4 only; trigger a change reporting both families; confirm only the rule's IPv4-related entry changes. Reconfigure the Action to add IPv6; confirm the next execution adds an IPv6 entry without touching the IPv4 one. Reconfigure again to drop IPv6; confirm the previously-added IPv6 entry is removed from the rule shortly after saving (FR-017).
4. **Cleanup on Detach (User Story 4)** — Let an Action run at least once so it owns an entry, then detach it from the device page. Confirm the entry it added is gone from the rule in the Hetzner Console, and that the detach itself completed even before you check (it isn't blocked waiting on Hetzner).
5. **Concurrency (FR-009)** — Configure two Actions (different Trigger Devices) against two different rules on the *same* firewall. Trigger both at close to the same time (e.g. two manual re-runs fired back-to-back). Confirm both rules end up updated — neither update is lost to the other.

## Automated checks

```bash
pnpm --filter fluxip-backend test tests/unit/adapters/actions/hetzner-firewall-executor.test.ts
pnpm --filter fluxip-backend test tests/unit/domain/firewall-rule-selector.test.ts
pnpm --filter fluxip-backend test tests/contract/actions.test.ts
pnpm --filter fluxip-backend test tests/integration/firewall-rule-action-lifecycle.test.ts
pnpm --filter fluxip-frontend test firewall-rule-target-step
npx playwright test action-wizard.spec.ts   # extended with the firewall Action type selection + config
```

Expected outcomes: the unit tests prove `matchFirewallRule` (data-model.md) is the single source of truth used by both the route and the executor and that the executor only ever touches its own `firewallOwnedEntries` CIDR in `source_ips`/`destination_ips`; the contract test proves `POST`/`PUT` reject a non-unique selector before any event is appended (FR-018) with the error shapes in `contracts/actions-api.md`; the integration test proves the full attach → execute → execute-again (old entry replaced, static entry untouched) → reconfigure-drops-family (cleanup attempted) → detach (cleanup attempted) lifecycle end-to-end against real Postgres + Redis, including the locked concurrent-update case (FR-009/SC-004); the frontend/Playwright additions cover the new wizard step.

## What this quickstart does not cover

SC-001 ("under 5 minutes" to configure) and SC-002/SC-006 (propagation/cleanup success-rate percentages) are timed/statistical criteria tracked via manual timing and production observability, not asserted by `pnpm test`/`playwright test` — same convention as 001's and 004's equivalent success criteria.

SC-004's specific volume claim ("at least 100 concurrent update pairs") is likewise not what the automated integration test (`firewall-rule-action-lifecycle.test.ts`) proves — that test exercises a single concurrent pair to prove the locking mechanism is correct in principle (no lost update between two racing writes to the same firewall). Confirming the guarantee holds at the stated volume is a production/load-test concern, tracked separately, the same way SC-002's "99%" is.
