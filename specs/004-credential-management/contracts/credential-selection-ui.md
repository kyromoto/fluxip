# UI Contract: Credential selection & inline creation in the Action wizard

Governs `frontend/src/flows/action-wizard/steps/DnsTargetStep.tsx` (User Story 2, FR-011/012/013). Builds on 003-end-user-ui-redesign's `contracts/wizard-shell.md` and `contracts/empty-state.md`, which still govern the wizard's own step/progress/cancel behavior and this feature does not change.

## Dropdown behavior (FR-011)

- Populated from `GET /api/provider-credentials`, filtered to the Credential Type(s) the selected Action type requires (for `update_dns_record`: `provider === "hetzner"`).
- Each option is labeled by the credential's chosen `label` (never by `credentialId` or the masked secret) — this is the FR-011 requirement that entries be distinguishable by name.
- Selecting an option sets `ActionWizardData.providerCredentialId`; the step's `isValid` gate (unchanged) still requires a non-empty value before `Next` is enabled.

## Empty-state / inline creation (FR-012/013)

| Condition | Behavior |
|---|---|
| Credentials list resolves to zero entries of the required type | The dropdown is replaced by an inline prompt ("You don't have a Hetzner credential yet.") plus a button that opens `CredentialFormDialog` — **not** a redirect to `/credentials`, and the `ActionWizard` instance is never unmounted (contracts/wizard-shell.md's data-preservation guarantee is trivially satisfied because the wizard never leaves the page). |
| List has ≥1 entry | An "Add a new credential" secondary action is still available next to the dropdown (not only in the empty case), so a user isn't forced to leave the Credentials area to add a second/third entry mid-flow. |
| `CredentialFormDialog` submitted successfully | Dialog closes; the credentials resource is refetched; the newly created entry is auto-selected as `providerCredentialId`; the user remains on the same wizard step with everything else they'd already entered (zone, record name, address family choices on other steps) untouched. |
| `CredentialFormDialog` cancelled | Dialog closes; no partial credential is created (matches the create-credential form's own validation — nothing is submitted until its own confirm action); wizard state is unchanged. |

## Shared component: `CredentialFormDialog`

The same component (and the same `POST /api/provider-credentials` call) backs both:
1. The standalone Credentials page's "Add credential" action (User Story 1).
2. This inline empty-state/add-another affordance inside the Action wizard.

Props: `{ open: boolean; onOpenChange: (open: boolean) => void; onCreated: (credential: { credentialId: string; provider: string; label: string; secretLast4: string }) => void }`. The caller decides what happens after creation (Credentials page: prepend to its list; DnsTargetStep: select it and continue the wizard) — the dialog itself has no knowledge of which context it's opened from.

## Invariants

1. **Never a dead end**: a user configuring a Hetzner DNS Action with zero stored Hetzner credentials always has a direct, in-place path to create one, per FR-012.
2. **No data loss**: entering the credential-creation dialog and completing (or cancelling) it never discards any value already entered in another step of the same `ActionWizard` run, per FR-013.
3. **One creation form**: the create-credential form is not duplicated between the Credentials page and the wizard — both call `CredentialFormDialog`.
