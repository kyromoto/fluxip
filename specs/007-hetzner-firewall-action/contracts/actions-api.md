# Contract: Actions API (extends the "Actions" section of 001's `management-api.md`)

REST endpoints under the existing authenticated Management API (Logto-verified `Authorization: Bearer <token>`; the token's subject claim determines `accountId` — see 001's `contracts/management-api.md` for the shared auth model, which is unchanged). Response bodies below are illustrative field lists, not a full OpenAPI schema.

**This document extends, not supersedes, 001's "Actions" table.** Every existing row (`GET`/`POST`/`PUT`/enable/disable/`DELETE`/`run`/`executions`) keeps working exactly as before for `hetzner_cloud_dns_update` Actions. The rows below describe what changes only when `type` is `hetzner_cloud_firewall_rule_update`.

| Method & Path | Purpose | Notes for the Firewall Rule Update Action type |
|---|---|---|
| `POST /api/ip-clients/{ipClientId}/actions` | Attach a new Action | Body's `config` is `{ providerCredentialId, firewallId, direction, protocol, port?, description }` (data-model.md). **Before appending `action.attached`**, the route decrypts the credential and calls the Hetzner Cloud API to confirm the selector resolves to exactly one rule on `firewallId` (FR-018, research.md §6) |
| `PUT /api/actions/{id}` | Reconfigure | If `config` is provided, the same eager rule-selector check as `POST` runs first (FR-018). If the resulting `addressFamilies` drops a family present in the Action's current `firewallOwnedEntries`, a single best-effort attempt to remove that family's entry from the live rule is made **after** `action.reconfigured` is appended — its failure does not undo or block the reconfiguration (FR-017) |
| `DELETE /api/actions/{id}` | Detach | After `action.detached` is appended (unconditionally), a single best-effort attempt removes every family in `firewallOwnedEntries` from the live rule; failure is logged, not surfaced as a request error (FR-010/FR-011) |
| `GET /api/actions/{id}/executions` | Execution history | Unchanged — a firewall update's `providerResponseSummary`/error text just describes the Hetzner Firewall call instead of the DNS call (FR-016) |

## New validation errors (config-time, `POST`/`PUT` only)

| Status | `error` body | Condition |
|---|---|---|
| `400` | `"config.firewallId, direction, protocol, and description are required"` | Missing required field for this Action type |
| `400` | `"firewall_not_found"` | `firewallId` doesn't exist, or the credential can't reach it (invalid/revoked token — same class as `invalid providerCredentialId` for the DNS type) |
| `422` | `"rule_selector_no_match"` | The selector matched zero rules on the firewall (FR-018) |
| `422` | `"rule_selector_ambiguous"` | The selector matched more than one rule on the firewall (FR-018) |

These mirror, at configuration time, the same failure the executor itself can hit later at execution time (FR-008) if the firewall changes after the Action was configured — that later failure still surfaces the normal way, through `action_execution.failed` (unchanged from 001).

## Unchanged from 001

- Every list/get/reconfigure/detach scopes to the caller's `accountId`; a request touching another account's Action returns `404` (FR-013/SC-003 of 001, matching the cross-cutting convention).
- `config.providerCredentialId` must reference an `active` credential owned by the same account — unchanged, now also enforced for this Action type's credential.
- `POST /api/actions/{id}/run` and `GET /api/actions/{id}/executions` behave identically regardless of Action type.
