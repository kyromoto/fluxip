# Phase 1 Data Model: Provider Credential Management

This feature extends the `provider_credential` aggregate already defined in `specs/001-ip-change-automation/data-model.md` (event-sourced; own aggregate stream, identified by `credentialId`; every event carries `account_id`). It does **not** introduce a new aggregate. Only the deltas are documented below — see 001's `data-model.md` for the full original definition, relationships diagram, and cross-cutting rules (account isolation, event-store immutability, disposable projections), which continue to apply unchanged.

## Aggregate: `provider_credential` (extended)

**Derived state** (changes from 001 in **bold**):

| Field | Type | Notes |
|---|---|---|
| `credentialId` | string | Aggregate ID |
| `accountId` | string | Owning account |
| `provider` | string, extensible | `"hetzner"` in this iteration; doubles as the spec's "Credential Type" identifier (FR-005) |
| `label` | string | User-chosen display name; **now required unique (case-insensitive) among the account's other active entries (FR-003)** |
| `encryptedSecret` | string | Reversibly encrypted secret value; **never decrypted for display purposes (FR-004a) — decrypted only at Action-execution time to call the provider's API** |
| **`secretLast4`** | **string** | **NEW — the secret's last 4 characters, captured in cleartext once at creation time; the only fragment of the secret ever returned by any read (FR-004/FR-004a)** |
| `status` | `active` \| `revoked` | **`revoked` is now also the mechanism for FR-009's "permanently delete"; still irreversible, no `unrevoke` event exists** |

**Events** (changes from 001 in **bold**):

- `provider_credential.stored` — `{ credentialId, accountId, provider, label, encryptedSecret, `**`secretLast4,`**` storedAt }`
- ~~`provider_credential.rotated`~~ — **not used by this feature**: rotating a secret in place is out of scope for this iteration (spec Assumptions); the event type may remain defined in code for forward-compatibility but no route in this feature appends it. To change a token, a user deletes the unreferenced entry and creates a new one.
- `provider_credential.revoked` — `{ credentialId, revokedAt }` — **now additionally gated: MUST NOT be appended while any non-`detached` `action` aggregate's `config.providerCredentialId` equals this `credentialId` (FR-010). The check replays `action` aggregates directly (see research.md §2) — it is enforced at the HTTP route, not as a reducer-level invariant, since the `provider_credential` aggregate has no dependency on `action` state.**

**Invariants** (changes from 001 in **bold**):

- Reusable across any number of that account's `action` aggregates (FR-008/FR-020) — unchanged.
- **A `label` must be unique, case-insensitively, among the same account's other `active` entries (FR-003); enforced at credential-creation time, not as a stored uniqueness constraint.**
- **`revoked` MUST NOT be reachable while ≥1 `action` aggregate (status `enabled` or `disabled`, i.e. not `detached`) references `credentialId` in its `config.providerCredentialId` (FR-009/FR-010).**
- **The full plaintext secret is never included in `stored`'s response beyond the initial `201 Created` acknowledgment, and never appears in any subsequent event, projection, or API response — only `secretLast4` does (FR-004a).**

## Relationship to `action` (unchanged from 001, restated for this feature's context)

```text
account (1) ──< (many) provider_credential
action (many) ──> (1) provider_credential   [config.providerCredentialId]
```

This feature reads this relationship in the opposite direction from 001's original usage (001 only *validated* a referenced credential exists/is active when an Action is created/reconfigured; this feature additionally *queries* it — "which Actions reference this credential?" — to gate deletion).

## New read shape: Credential Type label mapping (frontend-only, no new entity)

Not a data-model change (see research.md §6) — documented here because it's user-visible. The frontend maps the aggregate's `provider` value to a friendly display name:

| `provider` value | Displayed as |
|---|---|
| `"hetzner"` | "Hetzner API Token" |

Unrecognized future values render their raw string as a fallback, so adding a new Credential Type never requires a blocking frontend change to remain functional (only to gain a friendly label).
