# Phase 0 Research: Provider Credential Management

No `[NEEDS CLARIFICATION]` markers remained in `spec.md` after the `/speckit-clarify` session, so this phase focuses on reconciling the spec's decisions with the `provider_credential` aggregate and routes already built in 001-ip-change-automation, and choosing the lightest-weight implementation for each new requirement.

## 1. "Permanently delete" reuses the existing `revoked` status — no new event

**Decision**: FR-009's "permanently delete" is implemented as the `provider_credential.revoked` event/status already defined in 001's `data-model.md`, not a new `deleted` event.

**Rationale**: 001 never defined an "unrevoke" event, so `revoked` is already effectively a terminal, irreversible state — exactly what FR-009 asks for. Introducing a second "gone" event alongside it would duplicate meaning without adding behavior.

**Alternatives considered**: A distinct `provider_credential.deleted` event — rejected; no requirement in this spec needs to distinguish "revoked" from "deleted" as separate states.

**Consequence**: 001's `contracts/management-api.md` describes `DELETE /api/provider-credentials/{id}` as "Revoke... Actions referencing it will fail on next execution... not blocked at revoke time." This addendum **supersedes** that specific line (see `contracts/provider-credentials-api.md`) per this spec's FR-010/clarification: deletion is now blocked while referenced. 001's own document is left as a historical record of that plan's snapshot; the superseding behavior lives in this feature's contract.

## 2. Reference-check is a route-level guard, not an aggregate invariant

**Decision**: Before appending `revoked`, the `DELETE` handler replays every `action` aggregate for the tenant (via the existing `listAggregateIds` + `loadAggregate` pattern already used by `GET /provider-credentials`) and rejects with `409` if any non-`detached` Action's `config.providerCredentialId` matches.

**Rationale**: Matches the existing precedent for cross-aggregate, request-time checks — e.g. `ip-clients.ts`'s `device_limit_reached` 409 replays the `account` aggregate before allowing a new IP Client. Keeps the `provider_credential` reducer free of any dependency on the `action` aggregate, preserving the hexagonal seam between them.

**Alternatives considered**: A saga/process manager keeping a live "reference count" — rejected as unnecessary machinery for a synchronous, bounded-cardinality check (SC-006: a handful of entries per account).

## 3. Masked value is a cleartext fragment stored at write time, never decrypted-on-read

**Decision**: `provider_credential.stored`'s event data gains one new field, `secretLast4` (the secret's last 4 characters, computed once at creation time from the plaintext the client just submitted). `GET`/list responses return `secretLast4` (rendered by the frontend as `••••1234`); the encrypted secret itself is never decrypted for display purposes.

**Rationale**: FR-004a requires the full secret is never retrievable through any interface after creation. Storing a small, deliberately-bounded cleartext fragment removes any code path that decrypts the full secret just to compute a mask — eliminating an entire class of accidental-full-disclosure bugs (e.g., a future logging statement on a decrypt-for-display path).

**Alternatives considered**: Decrypt the stored secret on each `GET` and truncate — rejected; reintroduces a decrypt operation with no functional need beyond display, directly conflicting with the "never returns the full secret after creation" clarification.

## 4. Name uniqueness enforced by replay, not a new index

**Decision**: `POST /provider-credentials` rejects (`409`) a `label` that case-insensitively matches an existing *active* credential's `label` for the same tenant, checked via the same `listAggregateIds` + `loadAggregate` loop the existing `GET` handler already performs.

**Rationale**: SC-006's scale (≥5 entries, not hundreds) makes an O(n) replay-and-compare check trivial; matches the codebase's existing style of deriving read-time answers from aggregate replay rather than introducing new persisted lookup structures for small `n`.

**Alternatives considered**: A dedicated unique constraint/lookup table for credential names — rejected as premature; revisit only if the per-account credential count grows to a scale where a full replay becomes measurably slow.

## 5. In-wizard credential creation is an inline dialog, not a wizard-of-wizards

**Decision**: FR-012/013 ("guide the user directly into creating one, without discarding the Action configuration already entered") is implemented as an inline `Dialog` opened from `DnsTargetStep` itself when the fetched credentials list for the required type is empty (or via an explicit "add a new credential" affordance next to the dropdown at any time). Submitting it calls the same `POST /provider-credentials` used by the standalone Credentials page, then refetches the dropdown's options and preselects the new entry — the `ActionWizard`/`useWizard` step machine is never exited, so there is nothing to "resume."

**Rationale**: `useWizard`/`WizardShell` (built in 003) implement a fixed, linear step list with no concept of pausing at a step, navigating to a different route, and resuming — and 003's own spec assumptions already establish that guided flows don't need to persist progress across navigation. Never leaving the wizard trivially satisfies "without discarding the Action configuration" (there is no navigation to lose it to), and reuses the exact same create-credential form as the standalone area (see `CredentialFormDialog.tsx` in Project Structure).

**Alternatives considered**: Navigating to `/credentials`, creating there, then returning to the in-progress Action wizard — rejected; would require new resume-state plumbing (persisting the partially-filled `ActionWizardData` across a route change) that doesn't exist today and that 003 deliberately chose not to build, for no benefit over an inline dialog.

## 6. Credential Type stays a free-text field; no registry entity

**Decision**: FR-005's extensibility requirement continues to ride on the existing `provider` field in `provider_credential.stored` (`"hetzner"` today). No new "Credential Type" reference-data entity or registry table is introduced in this iteration.

**Rationale**: Exactly one Credential Type exists; the field is already structurally free to hold future values (`"hetzner"` is just a string), and the frontend already maps known values to a friendly label (extending the existing pattern used for e.g. notification-channel `type`). A registry would add indirection with no present consumer.

**Alternatives considered**: A `credential_type` aggregate/table describing each type's shape — rejected as speculative; nothing in this spec requires types to be data-driven yet (only that adding a second one later doesn't require reshaping existing types, which the current free-text-field design already satisfies).

## 7. Delete-blocked error surfaces the specific referencing Actions

**Decision**: The `409` response for a blocked delete includes the referencing Actions' `actionId`, `ipClientId`, and DNS target (`zone`/`recordName`): `{ error: "credential_in_use", usedBy: [{ actionId, ipClientId, zone, recordName }] }`. The Credentials page renders this list directly (with a link to each Action's device page) rather than routing it through `lib/errors.ts`'s static `errorBody`-matching catalog, which only supports fixed strings and can't interpolate a dynamic list.

**Rationale**: FR-010 requires telling the user *which* Action(s) reference the credential, not just that some do. The existing error catalog (built in 003) is deliberately simple (exact-string match → fixed message) and was never meant to carry structured, per-request data.

**Alternatives considered**: A generic "this credential is in use" message with no detail — rejected; doesn't satisfy FR-010.

## 8. No new Redis projection for the Credentials list

**Decision**: `GET /provider-credentials` keeps serving from direct aggregate replay (as already implemented in 001), now including `secretLast4` and `provider` (Credential Type) in each item.

**Rationale**: Bounded by SC-006's small per-account scale; the existing implementation already forgoes a projection here, unlike the `action` list (which does use one, `actions-projection.ts`) because Actions are queried per-IP-Client far more frequently and at potentially higher counts.
