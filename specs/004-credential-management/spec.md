# Feature Specification: Provider Credential Management (Zugangsdaten-Verwaltung)

**Feature Branch**: `004-credential-management`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Ergänzung zur bestehenden Spezifikation: Benutzer benötigen einen eigenen UI-Bereich, um Zugangsdaten für externe Dienste (initial: Hetzner API-Token) zentral pro Account zu verwalten, unabhängig von einzelnen Trigger-Geräten oder Aktionen.

Kernanforderungen:

- Es gibt einen eigenständigen Bereich "Zugangsdaten" (oder vergleichbar benannt), in dem ein Benutzer API-Zugangsdaten für externe Dienste anlegen, ansehen (in maskierter Form) und löschen kann.
- Initial wird nur ein Zugangsdaten-Typ benötigt: ein Hetzner-API-Token. Die Struktur muss aber erweiterbar sein für weitere Zugangsdaten-Typen künftiger Aktionsanbieter.
- Es können mehrere Zugangsdaten-Einträge desselben Typs (z.B. mehrere Hetzner-API-Tokens) gleichzeitig existieren. Jeder Eintrag wird beim Anlegen mit einem eigenen, frei wählbaren Namen versehen (z.B. "Hetzner Hauptaccount", "Hetzner Kundenprojekt X"), damit der Benutzer sie im Auswahl-Dropdown des Aktions-Wizards eindeutig unterscheiden kann.
- Eine Aktion referenziert genau einen konkreten Zugangsdaten-Eintrag, nicht nur einen Typ, sodass z.B. Aktion A auf Credential-Eintrag "Hauptaccount" zeigt und Aktion B auf Credential-Eintrag "Kundenprojekt X", auch wenn beide vom selben Typ (Hetzner-API-Token) sind.
- Beim Anlegen einer Hetzner-DNS-Aktion im bestehenden Wizard wählt der Benutzer aus seinen bereits hinterlegten Hetzner-Zugangsdaten aus, statt das Token erneut einzugeben. Sind noch keine Zugangsdaten hinterlegt, führt der Wizard den Benutzer direkt zum Anlegen neuer Zugangsdaten, statt in eine Sackgasse zu laufen.
- Bereits hinterlegte Zugangsdaten werden im UI niemals im Klartext angezeigt, nur in maskierter Form (z.B. letzte 4 Zeichen).
- Ein Zugangsdaten-Eintrag kann von mehreren Aktionen desselben Benutzers wiederverwendet werden, muss also nicht pro Aktion erneut eingegeben werden.

Nicht-Ziele für diese Ergänzung:

- Keine Freigabe/Teilung von Zugangsdaten zwischen verschiedenen Benutzerkonten."

## Clarifications

### Session 2026-07-23

- Q: Should the raw secret value be retrievable from the backend at all after creation, or is it write-only from that point on? → A: Backend never returns the full secret in any API response after creation — only the masked form is ever computable/returned from then on.
- Q: If only disabled Actions reference a credential, should deletion still be blocked? → A: Any reference — from an enabled or disabled Action — blocks deletion, no distinction made.
- Q: Should a Provider Credential's secret be a single opaque value or a structured set of named fields per Credential Type? → A: A single opaque secret string; multi-field support is deferred until an actual future Credential Type needs it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create, View, and Delete Provider Credentials in a Dedicated Area (Priority: P1)

A user opens a new, dedicated "Credentials" area of the application — separate from any specific Trigger Device or Action. There they add a new Hetzner API token, giving it a name of their own choosing (e.g., "Hetzner Hauptaccount"). Afterward, the entry appears in a list showing its name, type, and a masked version of the token. When it's no longer needed, they can delete it.

**Why this priority**: This is the foundation the rest of the feature depends on. Without a place to store and see named credential entries, there is nothing for an Action to reference and no way to avoid re-entering tokens.

**Independent Test**: Can be fully tested by opening the Credentials area, creating a new Hetzner API Token entry with a chosen name and a token value, verifying it appears in the list with that name and only a masked token value (never the full value), and then deleting it and confirming it no longer appears.

**Acceptance Scenarios**:

1. **Given** a user with no stored credentials, **When** they open the Credentials area, **Then** they see a clear empty state explaining what credentials are for and a prominent way to add one.
2. **Given** a user creating a new credential, **When** they choose the "Hetzner API Token" type, enter a name and the token value, and save, **Then** the new entry appears in their credentials list showing its name and type, with the token shown only in masked form (e.g., its last 4 characters, the rest obscured).
3. **Given** an existing credential entry, **When** the user views it at any later time, **Then** the full token value is never shown in plaintext — only the masked form is ever displayed.
4. **Given** a credential entry that is not currently used by any Action, **When** the user deletes it, **Then** it is permanently removed and no longer appears in the credentials list or in any Action wizard's selection list.

---

### User Story 2 - Select an Existing Credential While Configuring a Hetzner DNS Action (Priority: P2)

While configuring a Hetzner DNS-Update Action in the existing guided Action wizard, a user reaches the step where a Hetzner API token is needed. Instead of typing the token again, they pick one of their already-named Hetzner credential entries from a dropdown. If they don't have any yet, the wizard leads them straight into creating one and then continues the Action configuration — instead of leaving them stuck.

**Why this priority**: This is what connects the credential store to its actual purpose. Without it, users would still have to re-enter tokens per Action, and the credential area would be disconnected from the rest of the product.

**Independent Test**: Can be fully tested by configuring a Hetzner DNS-Update Action for a user who already has at least one Hetzner credential (selecting it from the dropdown, no retyping), and separately for a user with zero Hetzner credentials (verifying the wizard routes them to create one and then resumes the Action configuration).

**Acceptance Scenarios**:

1. **Given** a user with at least one existing Hetzner credential, **When** they reach the credential step of the Action wizard, **Then** they see a dropdown listing their existing Hetzner credential entries by name and can select one without re-entering a token.
2. **Given** a user with two Hetzner credentials named differently (e.g., "Hauptaccount" and "Kundenprojekt X"), **When** they view the dropdown, **Then** each entry is clearly distinguishable by its chosen name.
3. **Given** a user with zero Hetzner credentials, **When** they reach the credential step of the Action wizard, **Then** they are guided directly into creating a new Hetzner credential without losing the Action configuration already entered in earlier wizard steps.
4. **Given** a user who has just created a new credential from within the Action wizard, **When** credential creation completes, **Then** they return to the Action wizard with that new credential already available for selection, continuing their in-progress Action setup.

---

### User Story 3 - Reuse and Independently Reference Credentials Across Multiple Actions (Priority: P3)

A user managing several Hetzner projects has two Hetzner credential entries: "Hauptaccount" and "Kundenprojekt X". They configure one Action to use "Hauptaccount" and a second, independent Action to use "Kundenprojekt X" — even though both Actions are of the same type. Later, they also configure a third Action that reuses "Hauptaccount" again, without entering it a third time.

**Why this priority**: This confirms the data model actually delivers the value promised (reusable, independently selectable credential entries), rather than just having a UI that behaves like a single global setting per type. It matters less on day one than being able to create and select credentials at all.

**Independent Test**: Can be fully tested by creating two credential entries of the same type, assigning each to a different Action, assigning one of them to a second additional Action as well, and verifying each Action's configuration reflects the specific entry it was assigned — independently of the others.

**Acceptance Scenarios**:

1. **Given** two Hetzner credential entries owned by the same user, **When** the user configures Action A to use one entry and Action B to use the other, **Then** each Action's configuration references its own specific entry, distinct from the other.
2. **Given** a single credential entry, **When** the user assigns it to more than one Action, **Then** all of those Actions successfully reference and use that same entry without needing to re-enter it.
3. **Given** a credential entry that is currently referenced by one or more Actions, **When** the user attempts to delete it, **Then** the system prevents the deletion and tells the user which Action(s) currently reference it.

---

### Edge Cases

- What happens when a user tries to delete a credential entry that is still referenced by one or more of their Actions, whether those Actions are currently enabled or disabled? Deletion is blocked either way, and the user is told which Action(s) reference it so they can reassign or remove those Actions first.
- What happens when a user tries to create a new credential entry with a name that's identical (case-insensitive) to one they already have? The system rejects it and asks for a different name, since names must uniquely identify entries in selection lists.
- What happens when a user reaches the Action wizard's credential-selection step with zero credentials of the required type, but credentials of a different type? Only entries of the required type are offered; since there are none, the wizard routes the user into creating one of the correct type.
- What happens when a user abandons the in-wizard "create a credential" detour without finishing it? No partial credential entry is left behind, and the user remains in (or safely returns to) their in-progress Action configuration, consistent with how other guided flows handle abandonment.
- What happens when the underlying token in a credential entry becomes invalid or is revoked at the provider (e.g., Hetzner rejects it)? This is not detected by the Credentials area itself; it surfaces the next time an Action using that entry runs, through that Action's existing execution history.
- What happens when a user views the credentials list on a device/session where credential masking data hasn't loaded yet? No unmasked or partial token value is ever shown as a fallback; the entry is simply not shown as ready until its masked form can be displayed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated "Credentials" area, independent of any specific Trigger Device or Action, where an authenticated user can view all Provider Credential entries belonging to their own account.
- **FR-002**: System MUST allow a user to create a new Provider Credential entry by choosing a Credential Type (initially: "Hetzner API Token"), supplying the secret value, and assigning it a name of their own choosing.
- **FR-003**: System MUST require a Provider Credential entry's name to be unique (case-insensitive) among that user's own entries, regardless of Credential Type, so every entry is unambiguous wherever it is listed or selected.
- **FR-004**: System MUST NEVER display a stored Provider Credential's secret value in plaintext anywhere in the UI after creation; every view that shows the entry (including the Credentials area and any Action wizard) MUST show only a masked representation (e.g., the secret's last 4 characters, with the remainder obscured).
- **FR-004a**: System MUST NOT make a Provider Credential's full secret value retrievable through any interface (UI or API) after its initial creation; from that point on, only the masked representation is ever computable or returned, with no "reveal" capability.
- **FR-005**: System's Credential Type mechanism MUST be structured so that additional Credential Types, for future action providers, can be introduced without changing how existing Credential Types are stored, displayed, selected, or referenced.
- **FR-006**: System MUST support multiple, independently named Provider Credential entries of the same Credential Type existing simultaneously within one user account.
- **FR-007**: System MUST require every Action that needs a Provider Credential to reference exactly one specific Provider Credential entry — never merely a Credential Type — so that different Actions of the same type can point at different entries.
- **FR-008**: System MUST allow the same Provider Credential entry to be referenced by more than one of that user's Actions at the same time.
- **FR-009**: System MUST allow a user to permanently delete their own Provider Credential entry, provided it is not currently referenced by any of that user's Actions.
- **FR-010**: System MUST prevent deletion of a Provider Credential entry that is currently referenced by one or more Actions — regardless of whether those Actions are enabled or disabled — and MUST inform the user which Action(s) reference it.
- **FR-011**: When configuring a Hetzner DNS-Update Action, the guided Action wizard MUST let the user select an existing Hetzner Provider Credential entry — identified by its chosen name — from a list of that user's own entries of that type, instead of re-entering the token.
- **FR-012**: When a user reaches the credential-selection step of the Action wizard with no Provider Credential entry of the required type, the system MUST guide them directly into creating one, without discarding the Action configuration already entered in earlier steps of that same wizard run.
- **FR-013**: After a Provider Credential entry is created via the in-wizard creation path, the system MUST return the user to the Action wizard with that new entry available for selection, resuming the same in-progress Action configuration.
- **FR-014**: System MUST ensure a user can only view, create, or delete Provider Credential entries belonging to their own account, and MUST ensure a Provider Credential entry can only be referenced by Actions belonging to that same account — consistent with the account isolation already required for Trigger Devices and Actions.

### Key Entities

- **Credential Type**: Defines the kind of secret a Provider Credential entry holds and which action providers can use it (initially: "Hetzner API Token"). Designed to be extended with further types as additional action providers are introduced, without disrupting existing types.
- **Provider Credential**: A named, typed, user-owned secret entry (e.g., a Hetzner API token) belonging to exactly one user account. Has a Credential Type, a user-chosen name unique within that account, and a single opaque secret value that is stored securely, is never returned in full through any interface once created, and is only ever shown or retrievable in masked form thereafter. May be referenced by zero or more of that account's Actions (enabled or disabled) whose type requires a matching Credential Type; deletable only while completely unreferenced. Extends the reusable "Provider Credential" concept from the core FluxIP specification with explicit naming, typing, and multi-entry support.
- **Action** *(existing entity, referenced here)*: A user-configured unit of work attached to a Trigger Device. Where its type requires a Provider Credential (e.g., the Hetzner DNS-Update Action), it now stores a reference to exactly one specific Provider Credential entry, rather than an inline or type-only credential value.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a new named Hetzner credential entry and see it listed with a masked value in under 1 minute.
- **SC-002**: 100% of Provider Credential secret values are shown only in masked form across every screen where credential entries appear, and zero instances of a full, unmasked secret value are returned by the system through any interface once creation has completed.
- **SC-003**: A user configuring a Hetzner DNS-Update Action who already has at least one matching credential entry completes credential selection without ever retyping the underlying token.
- **SC-004**: A user with zero existing credentials who starts configuring a Hetzner DNS-Update Action can create the needed credential and complete that same Action-configuration attempt in one continuous flow, without restarting the wizard from the beginning.
- **SC-005**: Across repeated testing, zero credential entries are ever successfully deleted while still referenced by an existing Action.
- **SC-006**: A single account can maintain at least 5 simultaneously active, independently named credential entries of the same Credential Type, each individually selectable without ambiguity.

## Assumptions

- This feature extends the "Provider Credential" entity already introduced in the FluxIP Core specification (001-ip-change-automation), which established that a credential is reusable across an account's Actions; this addendum makes that concrete by introducing named, typed, individually selectable entries and a dedicated management area, rather than changing that underlying reuse guarantee.
- The credential-selection step described here (User Story 2) becomes part of the existing guided Action-configuration wizard from the End-User UI Redesign specification (003-end-user-ui-redesign, User Story 3), rather than introducing a separate, new wizard.
- Editing or rotating an existing Provider Credential entry's secret value in place is out of scope for this iteration; to change the underlying token, a user deletes the old entry (once no Action references it) and creates a new one.
- No numeric limit is placed on how many Provider Credential entries an account may hold in this iteration.
- A Provider Credential's secret is modeled as a single opaque string, matching the single Hetzner API token needed today; a Credential Type requiring more than one secret field (e.g., a future access-key/secret-key pair) is deferred until such a provider is actually specified.
- Validating a stored token against the third-party provider (e.g., confirming a Hetzner token is still valid or has sufficient permissions) is not part of this feature; invalid or revoked tokens are only surfaced indirectly, through the existing Action execution history, when an Action using that entry is next run.
- No sharing, transfer, or cross-account visibility of Provider Credential entries is supported, per the stated non-goal; every entry remains scoped to the single account that created it.
