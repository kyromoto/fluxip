# Feature Specification: IP-Change-Triggered Automation (FluxIP Core)

**Feature Branch**: `001-ip-change-automation`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "FluxIP ist ein Automatisierungssystem, das Aktionen auslöst, wenn sich die öffentliche IP-Adresse eines Trigger-Geräts ändert (z.B. eine FritzBox, die vom ISP eine neue IP zugewiesen bekommt). Benutzer registrieren sich und verwalten ihr Konto eigenständig. Ein Benutzer kann mehrere Trigger-Geräte anlegen. Für jedes Trigger-Gerät kann der Benutzer eine oder mehrere Aktionen konfigurieren, die bei einer IP-Änderung ausgeführt werden. Initial wird nur eine Aktion benötigt, die einen DNS-Eintrag in der Hetzner Console aktualisiert, aber das System muss erweiterbar für weitere Aktionstypen sein (z.B. Firewall-Regeln). Trigger-Geräte melden IP-Änderungen über einen DynDNS-kompatiblen Update-Mechanismus. Vollständige Mandantentrennung zwischen Benutzern ist erforderlich. Die Anwendung muss horizontal skalierbar sein ohne Doppelverarbeitung oder lokalen Zustand. Langfristiges Ziel ist SaaS-Betrieb. Deployment als Docker-Container."

## Clarifications

### Session 2026-07-22

- Q: Wie sollen sich Trigger-Geräte gegenüber dem System authentifizieren? → A: Jedes Gerät erhält eigene, eindeutige Zugangsdaten, analog zu klassischen DynDNS-Anbietern.
- Q: Können die Zugangsdaten eines Trigger-Geräts erneuert werden? → A: Ja, Zugangsdaten müssen ohne Löschen des Geräts erneuerbar (rotierbar) sein.
- Q: Sind Provider-Credentials (z.B. Hetzner API-Token) pro Account wiederverwendbar? → A: Ja, ein Credential ist über mehrere Actions desselben Accounts hinweg wiederverwendbar.
- Q: Soll es ein Retry-Verhalten bei fehlgeschlagenen Action-Ausführungen geben? → A: Ja, mit Backoff; genaue Parameter (Anzahl, Intervalle) werden in der Planungsphase festgelegt.
- Q: Sollen mehrere Actions eines Geräts unabhängig voneinander laufen, und soll ein manueller Re-Run möglich sein? → A: Ja, Actions laufen unabhängig voneinander; ein einzelner fehlgeschlagener Lauf kann über die UI manuell mit der letzten bekannten IP erneut ausgeführt werden.
- Q: Soll die DNS-Update-Action auch neue DNS-Einträge anlegen können? → A: Nein, es werden ausschließlich bereits existierende Einträge aktualisiert.
- Q: Wie soll IP-Flapping gehandhabt werden? → A: Das System führt Actions so schnell wie möglich aus, vermeidet aber redundante Ausführungen bei kurzfristigem Flapping; genaue Zeitparameter werden in der Planung festgelegt.
- Q: Welcher Schlüssel wird für die Idempotenz/Deduplizierung von IP-Change-Reports verwendet? → A: Geräte-ID kombiniert mit dem gemeldeten IP-Wert.
- Q: Soll das System nur IPv4 oder auch IPv6 unterstützen? → A: Actions sind pro Adressfamilie konfigurierbar (IPv4, IPv6 oder beides) — z.B. bei der DNS-Action. Ist eine Familie konfiguriert, muss das Gerät sie liefern, sonst schlägt die Ausführung fehl; liefert das Gerät eine nicht konfigurierte Familie zusätzlich, ist das kein Fehler.
- Q: Auf welcher Architektur soll die Ereignis-/Ausführungshistorie basieren? → A: Event Sourcing (append-only Event-Log als Quelle der Wahrheit); ob Kompaktierung/Snapshots unterstützt werden, wird später in der Planung entschieden.
- Q: Was passiert beim Löschen/Schließen eines Accounts? → A: Sofortige, endgültige Löschung von Account und allen zugehörigen Daten, ohne Wiederherstellungsfrist.
- Q: Soll es ein Limit für Trigger-Geräte pro Account geben? → A: Ja, ein per Deployment-Konfiguration einstellbares Default-Limit, das ein Administrator zur Laufzeit pro Account individuell anpassen kann.
- Q: Sollen Benachrichtigungen zu Action-Ausführungen unterstützt werden? → A: Ja, bereits in v1 per E-Mail (weitere Kanäle später), optional, Kanal-Konfiguration pro Account, Erfolgs-/Fehler-Einstellung pro Trigger-Gerät.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic DNS Update on IP Change (Priority: P1)

A user registers an account, adds a Trigger Device representing their home router, and configures a DNS-Update Action for that device pointing at a specific DNS record in their Hetzner account. When the router's public IP address changes, the system detects the change and automatically updates the DNS record to the new IP — without the user having to do anything manually.

**Why this priority**: This is the entire reason FluxIP exists. Without this end-to-end flow working, there is no product. Every other capability supports or extends this core loop.

**Independent Test**: Can be fully tested by registering a user, creating one Trigger Device, attaching one DNS-Update Action, sending a simulated IP-change report for that device, and verifying the corresponding Hetzner DNS record is updated to the new IP with no further user action.

**Acceptance Scenarios**:

1. **Given** a user with a Trigger Device that has one enabled DNS-Update Action, **When** the device reports a new public IP that differs from its last known IP, **Then** the system updates the configured Hetzner DNS record to the new IP and records the execution as successful.
2. **Given** a Trigger Device that has just reported an IP change and had its action executed successfully, **When** the same device reports the identical IP again, **Then** the system takes no action and does not re-trigger the DNS update.
3. **Given** a Trigger Device with a DNS-Update Action pointing at an invalid or unreachable DNS record, **When** an IP change is reported, **Then** the system records the action execution as failed with an error reason, visible to the user.

---

### User Story 2 - Manage Multiple Isolated Trigger Devices (Priority: P2)

A user with several locations (e.g. home and a vacation property) adds a separate Trigger Device for each location, each with its own independent set of Actions. The user can add, edit, disable, or remove any of their Trigger Devices and Actions at any time. No other user of the system can ever see, use, or affect this user's devices, actions, or stored credentials, regardless of how many users or application instances are active.

**Why this priority**: Multi-device management and strict tenant isolation are what make FluxIP usable by more than one household and safe to run as a shared, multi-instance service. This is required before the product can be trusted with real credentials at any scale.

**Independent Test**: Can be fully tested by creating two separate user accounts, each configuring multiple Trigger Devices and Actions, then verifying via each user's own view that neither can see, list, modify, or trigger the other's devices, actions, or credentials.

**Acceptance Scenarios**:

1. **Given** a user with two Trigger Devices at different locations, **When** the user updates the Action configuration on one device, **Then** the other device's configuration and execution history remain unchanged.
2. **Given** two users each with their own Trigger Devices, **When** either user lists their devices or actions, **Then** only that user's own devices, actions, and credentials are ever returned or visible.
3. **Given** a user attempts to reference another user's stored credential or DNS record configuration while creating an Action, **When** the configuration is saved, **Then** the system rejects the attempt.

---

### User Story 3 - Review, Retry & Get Notified About Automation Outcomes (Priority: P3)

A user wants to confirm that their automation is actually working, understand why a DNS record didn't update as expected, retry a failed execution without waiting for the next IP change, or be notified as soon as an execution completes. They open their Trigger Device and see a history of reported IP changes and the outcome (success or failure, with error details) of every Action that was executed as a result; from there they can manually re-run a failed Action, and — if configured — receive an email notification for that execution.

**Why this priority**: Without visibility, manual recovery, and optional alerting, users cannot trust or troubleshoot an automation system that otherwise runs invisibly in the background. This is valuable but not required for the core loop to function.

**Independent Test**: Can be fully tested by triggering a mix of successful and failing Action executions for a device, verifying the user can view a chronological history showing each reported IP change and each Action's outcome, manually re-running a failed Action, and — if a Notification Channel is configured — receiving the corresponding email notification.

**Acceptance Scenarios**:

1. **Given** a Trigger Device with a history of IP changes, **When** the user views that device, **Then** they see each reported IP change with its timestamp and the outcome of every Action executed for it.
2. **Given** an Action execution that failed, **When** the user views the history entry, **Then** they see enough detail to understand the reason for the failure.
3. **Given** an Action execution that failed, **When** the user manually re-runs that specific Action using the Trigger Device's last known IP, **Then** the system executes only that Action and records a new Execution Record reflecting the outcome.
4. **Given** a Trigger Device configured to send notifications for both successes and failures, **When** an Action execution completes, **Then** the account's configured notification email address(es) receive a notification reflecting that outcome.

---

### Edge Cases

- What happens when a Trigger Device reports an IP identical to its last known IP? The system must treat this as a no-op and not re-execute Actions.
- What happens when a Trigger Device's reporting credential is invalid, revoked, or missing on an incoming report? The report must be rejected and no Action executed.
- What happens when an Action execution fails (e.g., the third-party API is unreachable, rejects the credential, or the target record doesn't exist)? The failure must be recorded with enough detail for the user to diagnose it, and must not crash or block processing of other devices' events.
- What happens when a user deletes a Trigger Device or an Action while an IP-change report for it is already being processed? The in-flight processing must complete or be discarded safely, without operating on now-deleted configuration.
- What happens when the same IP-change report is received or processed by more than one running instance of the application at the same time (e.g., a duplicate DynDNS update request, or a retry from the router)? Exactly one set of Action executions must result — never zero, never more than one.
- What happens when a Trigger Device changes IP very frequently in a short period (flapping)? The system must avoid executing Actions (and calling third-party APIs) once per flap; it should reflect only the settled/latest IP.
- What happens when a user configures an Action referencing a DNS zone or record they don't actually control in Hetzner? The action execution fails with the third-party provider's rejection, and this is surfaced to the user rather than silently retried forever.
- What happens when an Action execution fails and the user wants to retry without waiting for a new IP-change report? The user can manually re-run that specific Action using the Trigger Device's last known IP.
- What happens when an Action is configured to require an address family (IPv4 and/or IPv6) that the reported IP-change data does not include? That Action's execution fails, since a required family is missing.
- What happens when a Trigger Device reports an address family that none of its configured Actions is set to act on? That family is ignored for that Action; this is not an error.
- What happens when a user tries to add a Trigger Device beyond their account's current device limit? Creation is blocked until an administrator raises the account's limit or an existing device is removed.
- What happens when a user closes or deletes their account? The account and all of its Trigger Devices, Actions, Provider Credentials, and Execution Records are deleted immediately and permanently, with no recovery period.
- What happens when a Trigger Device has no Notification Channel configured, or notifications are disabled for it? No notification is sent for its executions; notifications are opt-in and off by default.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a new user to self-service register an account using an email address and a password (or an equivalent unique identifier and credential), without requiring administrator involvement.
- **FR-002**: System MUST allow a registered, authenticated user to change their password and to delete their account from within the application's own UI, independently and without administrator involvement — even though the identity provider (not FluxIP) is the technical system of record for the credential itself (see Assumptions).
- **FR-003**: System MUST allow an authenticated user to create, view, edit, and delete any number of Trigger Devices under their own account (subject to the account's device limit, see FR-033).
- **FR-004**: System MUST issue each Trigger Device its own unique reporting credential, separate from the user's account login, so the physical device can be configured to report to the system independently of the user's session.
- **FR-005**: System MUST accept IP-change reports authenticated by a Trigger Device's reporting credential, and MUST reject reports whose credential is missing, invalid, or revoked.
- **FR-006**: System MUST compare each accepted IP-change report against the Trigger Device's last known IP (per address family) and MUST treat a report with no changed address family as a no-op that does not execute any Action.
- **FR-007**: System MUST allow a user to configure one or more Actions per Trigger Device, each specifying what should happen when that specific device's IP changes.
- **FR-008**: System MUST support, as its initial Action type, updating a user-specified, already-existing DNS record in Hetzner Console to the newly reported IP address; creating new DNS records is not supported.
- **FR-009**: System's Action mechanism MUST be structured so that additional Action types (e.g., updating Hetzner firewall rules) can be introduced later without changing how Trigger Devices, IP-change detection, or existing Action types operate.
- **FR-010**: System MUST automatically execute every enabled Action configured for a Trigger Device whenever that device's IP change is confirmed, with no manual step required from the user.
- **FR-011**: System MUST record the outcome (success, or failure with an error reason) of every Action execution, and MUST make this history visible to the user who owns the Trigger Device.
- **FR-012**: System MUST ensure a user can only view, create, edit, or delete Trigger Devices, Actions, and stored credentials belonging to their own account.
- **FR-013**: System MUST prevent any data or configuration belonging to one user from being visible or modifiable by another user under any circumstance, including when a user attempts to reference another user's credentials or DNS configuration.
- **FR-014**: System MUST process each distinct IP-change report exactly once with respect to Action execution — using the combination of the Trigger Device's identifier and the reported IP value as the deduplication key — even when multiple instances of the application are running concurrently, so that Actions are never executed more than once for the same change nor silently skipped.
- **FR-015**: System MUST NOT depend on state held only in the memory or local disk of a single running instance to correctly detect IP changes or execute Actions; all state needed for correct processing must be available to any instance handling a given report.
- **FR-016**: System MUST store third-party credentials used by Actions (e.g., Hetzner API tokens) so that they are never exposed to any user other than the owning account.
- **FR-017**: System MUST allow a user to enable or disable an individual Trigger Device or Action without deleting its configuration.
- **FR-018**: System MUST be packaged and operable as a Docker container.
- **FR-019**: System MUST allow a user to rotate (regenerate) a Trigger Device's reporting credential at any time, without deleting the device, immediately invalidating the previous credential.
- **FR-020**: System MUST allow a Provider Credential to be created once per user account and reused across multiple Actions belonging to that same account.
- **FR-021**: System MUST automatically retry a failed Action execution using a bounded backoff strategy before recording it as a final failure; the specific retry count and intervals are determined during planning.
- **FR-022**: System MUST execute the Actions configured for a single Trigger Device independently of one another, such that the failure of one Action has no effect on whether any other Action for the same IP change executes or on its outcome.
- **FR-023**: System MUST allow a user to manually re-run an individual Action using its Trigger Device's last known IP address (e.g., to retry after a failure), without waiting for a new IP-change report.
- **FR-024**: System MUST execute Actions for a confirmed IP change as promptly as possible, while applying a debounce/settling mechanism so that rapid, repeated IP changes ("flapping") from the same device do not each independently trigger Action executions; exact timing parameters are determined during planning.
- **FR-025**: System MUST allow each Action to be configured for which public IP address family — IPv4, IPv6, or both — it acts on, where relevant to that Action type (e.g., the DNS-Update Action lets a user choose to maintain an IPv4 (A) record, an IPv6 (AAAA) record, or both).
- **FR-026**: System MUST fail an Action's execution when the triggering IP-change report is missing a value for any address family that Action is configured to act on.
- **FR-027**: System MUST NOT treat it as an error when a Trigger Device reports an address family that none of its configured Actions is configured to act on; such families are simply ignored.
- **FR-028**: System MUST allow a user to configure one or more email addresses as a Notification Channel at the account level.
- **FR-029**: System MUST allow a user to configure, per Trigger Device, whether notifications are sent for every completed IP-change-triggered execution, only for failed executions, or not at all.
- **FR-030**: System MUST send one notification per IP-change-triggered execution to the account's configured Notification Channel(s), consistent with that Trigger Device's notification setting.
- **FR-031**: System's notification mechanism MUST be structured so additional channel types beyond email can be introduced later without changing how notifications are triggered or configured.
- **FR-032**: System MUST immediately and permanently delete a user's account, together with all of that account's Trigger Devices, Actions, Provider Credentials, and Execution Records, upon account closure — with no recovery/undo period.
- **FR-033**: System MUST enforce a default maximum number of Trigger Devices allowed per user account, configurable at deployment time.
- **FR-034**: System MUST allow an administrator to adjust the Trigger Device limit for an individual user account at runtime, overriding the deployment-wide default for that account.

### Key Entities

- **User Account**: A self-registered individual with login credentials, who owns and manages their own Trigger Devices, Actions, Provider Credentials, and Notification Channel. Fully isolated from every other User Account.
- **Trigger Device**: A user-owned representation of a physical device (e.g., a specific FritzBox) that reports public IP changes. Holds its own unique, rotatable reporting credential, its last known public IPv4 and/or IPv6 address, its per-device notification setting (off / failures-only / all executions), and its enabled/disabled state.
- **Action**: A user-configured unit of work attached to a Trigger Device, executed independently of any other Action when that device's IP change is confirmed. Has a type (initially: "Update DNS Record"), type-specific configuration (including which IP address family or families it acts on), and an enabled/disabled state. Designed to support additional types beyond the initial one, and to be manually re-run on demand using the device's last known IP.
- **Provider Credential**: A user-owned secret (e.g., a Hetzner API token) used by one or more of that user's Actions to authenticate against a third-party service. Created once per account and reusable across that account's Actions; never visible across users.
- **Notification Channel**: A user-owned destination — initially one or more email addresses — configured at the account level to receive notifications about Action executions. Designed to support additional channel types beyond email.
- **Execution Record**: A logged outcome of one Action run for one reported IP change, including timestamp, the reported IP value(s), success/failure status, and error details on failure — derived from an authoritative, append-only event log.
- **Administrator**: An operator role, distinct from regular User Accounts, whose capability in this iteration is limited to adjusting an individual account's Trigger Device limit at runtime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from registration to a working, end-to-end DNS-update automation (account + device + action configured) in under 10 minutes without outside help.
- **SC-002**: At least 99% of confirmed IP changes result in the corresponding DNS record being updated within 5 minutes of the change being reported to the system.
- **SC-003**: Zero instances of one user viewing or modifying another user's Trigger Devices, Actions, or credentials occur under normal operation.
- **SC-004**: When the application runs as multiple concurrently active instances, IP-change reports produce no duplicate and no missed Action executions, across a sustained test of at least 1,000 reports.
- **SC-005**: A single user can manage at least 10 Trigger Devices, each with its own Actions, with no measurable degradation in configuration responsiveness or execution reliability.
- **SC-006**: A user reviewing an Action's execution history can identify the reason for a failed execution, without contacting support, in at least 90% of failure cases.
- **SC-007**: Users who enable notifications for a Trigger Device receive a notification for at least 99% of that device's IP-change-triggered executions within 1 minute of the execution completing.

## Assumptions

- Trigger Devices report IP changes using a DynDNS-compatible HTTP update mechanism, matching what FritzBox and similar routers natively support; no custom device firmware or push-based reporting is required for v1.
- The DNS record targeted by the initial "Update DNS Record" Action already exists in the user's Hetzner DNS zone for the address family/families it's configured for; creating brand-new DNS records is not required for v1.
- The system's history of IP-change events and Action executions is built on an event-sourcing architecture — an authoritative, append-only sequence of recorded events is the source of truth for that history; whether the event log later supports compaction or snapshotting is left open for the planning phase.
- Firewall-rule Actions and any billing/plan-tier features remain deferred to a later iteration, consistent with the stated non-goals; this iteration is limited to a per-account Trigger Device limit (FR-033/FR-034), not limits on the number of Actions per Trigger Device.
- The Administrator role's capabilities in this iteration are limited to adjusting a user's Trigger Device limit; a broader administrative console or additional admin capabilities are out of scope.
- Standard security practices apply by default: passwords are hashed, third-party credentials are encrypted at rest, and all management operations require authentication.
- The identity provider used for authentication is the technical system of record for the user's password (it owns storage/hashing), but the password-change action itself remains a native, in-app experience in FluxIP's own UI — the application proxies the change to the identity provider rather than redirecting the user to a separate provider-hosted page.
- An account is granted Administrator capability by having its identity-provider account assigned a dedicated role out-of-band (e.g., via the identity provider's own console); FluxIP does not provide its own workflow for granting or revoking this role in this iteration — it only checks for it (FR-034).
