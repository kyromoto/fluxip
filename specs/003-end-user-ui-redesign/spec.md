# Feature Specification: End-User UI Redesign

**Feature Branch**: `003-end-user-ui-redesign`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "FluxIP erhält eine überarbeitete Benutzeroberfläche, die modern aussieht, auf Desktop und Mobilgeräten gleichermaßen gut funktioniert, und sich an Endanwender richtet statt an technisch versierte Nutzer.

Kernanforderungen:

- Die UI ist vollständig responsive und funktioniert gleichwertig auf Desktop- und Mobilgeräten, nicht nur nachträglich angepasst.
- Das visuelle Erscheinungsbild ist modern; es gibt keine vorgegebene Markenidentität oder Referenz, die Gestaltung erfolgt frei, mit dem Ziel eines zeitgemäßen, neutralen Looks.
- Die UI unterstützt Dark Mode und Light Mode, wobei der Modus automatisch der Systemeinstellung des Nutzers folgt (kein manueller Umschalter erforderlich).
- Für folgende Bereiche werden mehrstufige Wizard-Flows eingesetzt, die Informationen schrittweise statt in einem einzigen großen Formular einsammeln: Anlegen eines neuen Trigger-Geräts; Konfiguration einer Aktion für ein Trigger-Gerät (z.B. Auswahl des DNS-Ziels); Erstregistrierung/Onboarding eines neuen Benutzerkontos.
- Außerhalb dieser drei Bereiche bleiben einfache, direkte Formulare/Ansichten dort, wo ein mehrstufiger Flow keinen erkennbaren Mehrwert bietet (z.B. reine Übersichtslisten, einzelne Werteänderungen).
- Sprache, Begriffe und Fehlermeldungen der UI sind für Endanwender verständlich formuliert, nicht in technischer Fachsprache (z.B. keine rohen Fehlercodes oder internen Begriffe wie 'Aggregat' oder 'Event' in sichtbaren Texten).
- Die bestehende technische Basis (SolidJS mit Router) bleibt unverändert; dies ist eine Überarbeitung von Aussehen und Interaktionsfluss, kein Technologiewechsel.

Nicht-Ziele für diese Spezifikation: Kein Wechsel des Frontend-Frameworks oder Routing-Ansatzes. Kein manueller Dark-/Light-Mode-Umschalter in dieser Iteration."

## Clarifications

### Session 2026-07-23

- Q: What is the minimum mobile viewport width the redesigned UI must fully support (no horizontal scrolling, no cut-off controls)? → A: 360px (common modern Android baseline).
- Q: When a list screen has no items yet (e.g. a new user's Trigger Device overview is empty), how should it guide the user toward the relevant guided flow? → A: The empty screen shows a clear message plus a prominent call-to-action button that directly starts the relevant guided flow.
- Q: Should the redesigned UI target a specific formal accessibility conformance level, or stay best-effort only? → A: WCAG 2.1 Level AA.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guided Account Onboarding (Priority: P1)

A brand-new visitor decides to try FluxIP. Instead of facing one long registration form, they are guided through a short sequence of focused steps (e.g., basic details, credential setup, initial preferences) that together create their account. Each step asks for only what's needed at that point, and the person always knows what step they're on and what's left.

**Why this priority**: Onboarding is the first impression of the redesigned product and the entry point to everything else. If a new, non-technical person can't comfortably get an account set up, no other improvement matters.

**Independent Test**: Can be fully tested by having a first-time visitor, with no prior product knowledge, go from the registration entry point to a fully created, usable account using only the on-screen guidance, on both a desktop browser and a mobile browser.

**Acceptance Scenarios**:

1. **Given** a new visitor starting registration, **When** they begin the onboarding flow, **Then** they are presented with a series of distinct, clearly-labeled steps rather than a single long form, and can see which step they're on and how many remain.
2. **Given** a visitor midway through onboarding, **When** they go back to a previous step to change an earlier answer, **Then** their other already-entered information is preserved and not lost.
3. **Given** a visitor who completes all onboarding steps successfully, **When** the final step is submitted, **Then** their account is created and they land in the main application, ready to add their first Trigger Device.
4. **Given** a visitor viewing the onboarding flow on a small mobile screen, **When** they proceed through the steps, **Then** every step is fully usable without horizontal scrolling or obscured controls.

---

### User Story 2 - Guided Trigger Device Setup (Priority: P2)

An account holder wants to start monitoring a new location (e.g., a second home). Instead of one dense form asking for a device name, credentials, and settings all at once, they're walked through adding the new Trigger Device step by step, with each step focused on one decision at a time.

**Why this priority**: Adding a Trigger Device is the first concrete step toward the product's core value (automated IP-change handling) and the most common setup action a user performs after onboarding.

**Independent Test**: Can be fully tested by an existing, logged-in user creating a brand-new Trigger Device from start to finish using only the guided flow, on both desktop and mobile, and confirming the device appears correctly afterward.

**Acceptance Scenarios**:

1. **Given** a logged-in user starting to add a Trigger Device, **When** they proceed through the guided steps, **Then** each step collects one focused piece of information (e.g., naming the device, then reviewing its generated access credential) rather than presenting all fields at once.
2. **Given** a user partway through the device-creation flow, **When** they cancel or navigate away before finishing, **Then** no incomplete or partial device is left behind in their account.
3. **Given** a user who completes the device-creation flow, **When** the last step is confirmed, **Then** the new Trigger Device is created and immediately visible in the user's device overview.

---

### User Story 3 - Guided Action Configuration (Priority: P3)

An account holder has a Trigger Device and wants to configure what should happen when its IP changes — for example, choosing which DNS record to keep updated. Rather than a single form mixing action type, target selection, and options together, they're guided through selecting the type of action and then filling in only the details relevant to that choice.

**Why this priority**: Configuring an Action is what actually turns a Trigger Device into working automation; it's slightly more involved than device creation because it depends on the chosen action type, which is why it benefits from its own guided flow.

**Independent Test**: Can be fully tested by a logged-in user with an existing Trigger Device configuring a new Action (e.g., selecting a DNS target) end to end via the guided flow, on both desktop and mobile, and confirming the resulting Action reflects their choices.

**Acceptance Scenarios**:

1. **Given** a user starting to configure an Action for a Trigger Device, **When** they proceed through the guided steps, **Then** they first choose what kind of action they want and are then only asked for the details relevant to that specific choice (e.g., which DNS target to update).
2. **Given** a user who has selected a DNS target as part of the flow, **When** they move to a later step, **Then** their target selection remains applied without needing to be re-entered.
3. **Given** a user who completes the Action-configuration flow, **When** the last step is confirmed, **Then** the Action is attached to the Trigger Device and visible in that device's list of configured actions.

---

### User Story 4 - Consistent, Responsive, Plain-Language Experience Everywhere Else (Priority: P4)

A user performs everyday tasks that don't need a multi-step flow — viewing their list of devices, checking execution history, changing a single notification setting, or reading an error after something goes wrong. These simple screens look and feel like part of the same modern, cohesive product as the guided flows, work equally well on a phone or a desktop, follow the device's dark/light appearance automatically, and describe problems in plain, everyday language.

**Why this priority**: This covers the majority of day-to-day screen time in the product. It's ranked after the three guided flows because it's about consistent polish across many existing, already-functional screens rather than introducing a new interaction pattern.

**Independent Test**: Can be fully tested by using the existing overview, history, and settings screens on both a desktop and a mobile browser, under both a light-mode and a dark-mode operating system setting, and by triggering at least one error condition to confirm the message shown is understandable without technical background.

**Acceptance Scenarios**:

1. **Given** a screen that only involves viewing a list or changing a single value (e.g., toggling a device on/off, viewing execution history), **When** the user opens it, **Then** it is presented as a direct, single-step view rather than a multi-step flow.
2. **Given** a user whose operating system is set to dark mode (or light mode), **When** they open the application, **Then** the application's appearance matches that system setting without the user having to select anything.
3. **Given** the operating system's light/dark setting changes while the application is open, **When** the user returns to or continues using the application, **Then** its appearance updates to match the new system setting.
4. **Given** an error occurs (e.g., a failed action execution or a rejected form submission), **When** the user sees the resulting message, **Then** it is phrased in plain, everyday language with no raw error codes, stack traces, or internal technical terms.
5. **Given** any screen in the application, **When** viewed on a narrow mobile screen versus a wide desktop screen, **Then** the layout and controls are equally usable on both, with no horizontal scrolling and no hidden or cut-off controls.

---

### Edge Cases

- What happens when a user starts the onboarding, device-creation, or action-configuration flow and closes the browser tab or loses connectivity partway through? No partially-created account, device, or action is left behind; the user can simply start the flow again.
- What happens when a user tries to go back to an earlier step in a guided flow after entering data in a later step? Previously entered data for steps that are still valid is preserved; only data that depends on the changed answer needs to be re-entered.
- What happens when the operating system's theme preference cannot be detected (e.g., an unusual or older browser)? The application falls back to a single default appearance rather than failing to render.
- What happens when a technical failure occurs behind the scenes (e.g., a backend or third-party service error)? The user sees a plain-language explanation of what went wrong and, where possible, what they can do next — never the raw underlying error.
- What happens when an already-registered user (from before this redesign) logs in? They go straight into the main application; the onboarding flow only appears for someone creating a brand-new account.
- What happens when a user resizes their browser window or rotates their mobile device mid-use? The layout adapts smoothly without losing entered form data or the user's place in a guided flow.
- What happens when a guided flow's step depends on data that fails validation (e.g., an invalid DNS target)? The user is told what's wrong in plain language and can correct just that step without losing progress from earlier steps.
- What happens when a user with zero Trigger Devices (or zero Actions on a device) opens the corresponding overview screen? Instead of a bare empty list, the screen shows a clear message and a prominent call-to-action that starts the relevant guided flow.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The UI MUST present a fully responsive layout that is equally functional and usable on both desktop and mobile screen sizes, rather than a desktop layout with minor mobile adjustments.
- **FR-002**: The UI MUST use a modern, visually cohesive, neutral design applied consistently across all screens, with no requirement to match any pre-existing brand identity.
- **FR-003**: The UI MUST automatically match its color appearance (dark or light) to the user's operating system preference, with no manual toggle presented to the user.
- **FR-004**: The UI MUST update its color appearance automatically if the user's operating system preference changes while the application is open, without requiring a manual reload initiated by the user for the change to take effect.
- **FR-005**: The system MUST present account onboarding/registration as a multi-step guided flow that collects information in logically grouped steps rather than a single large form.
- **FR-006**: The system MUST present creation of a new Trigger Device as a multi-step guided flow that collects information in logically grouped steps rather than a single large form.
- **FR-007**: The system MUST present configuration of an Action for a Trigger Device (including selection of a DNS target for the DNS-update action type) as a multi-step guided flow that collects information in logically grouped steps rather than a single large form.
- **FR-008**: Each multi-step guided flow MUST show the user their current step and how many steps remain (or an equivalent indication of overall progress).
- **FR-009**: Each multi-step guided flow MUST allow the user to return to a previous step and change their answer without losing already-entered, still-valid data from other steps.
- **FR-010**: Each multi-step guided flow MUST NOT leave behind a partially-created account, Trigger Device, or Action if the user abandons the flow before completing it.
- **FR-011**: Screens and interactions outside the three named guided flows (account onboarding, Trigger Device creation, Action configuration) MUST remain simple, direct, single-step forms or views, including overview/list screens and single-value changes.
- **FR-012**: The Action-configuration guided flow MUST be structured so that adding future action types beyond the initial DNS-update type does not require redesigning the overall flow.
- **FR-013**: All user-facing text — labels, instructions, confirmations, and error messages — MUST use plain, everyday language understandable by a non-technical end user.
- **FR-014**: The UI MUST NOT expose raw technical error codes, stack traces, or internal implementation terms (e.g., "event", "aggregate") in any user-facing text.
- **FR-015**: When an underlying operation fails, the UI MUST present a plain-language explanation of the failure in place of the raw underlying error.
- **FR-016**: The UI MUST remain fully usable — no horizontal scrolling, no hidden or cut-off controls — across viewport widths from 360px up to large desktop displays.
- **FR-017**: The redesigned UI MUST be implemented using the existing SolidJS-with-router technical foundation, without changing frontend framework or routing approach.
- **FR-018**: The onboarding guided flow MUST only be presented to visitors creating a new account; already-registered users MUST proceed directly to the main application on login.
- **FR-019**: Any list or overview screen that currently has no items (e.g. a new user's empty Trigger Device overview) MUST display a clear explanatory message together with a prominent call-to-action that directly starts the relevant guided flow (account onboarding, Trigger Device creation, or Action configuration, as applicable).
- **FR-020**: The redesigned UI MUST conform to WCAG 2.1 Level AA across both the light and dark appearance, including color contrast, keyboard operability, and screen-reader compatibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor with no prior product knowledge can complete account onboarding through the guided flow in under 3 minutes, on both a mobile and a desktop device.
- **SC-002**: A logged-in user can create a new Trigger Device and configure its first Action (e.g., selecting a DNS target) using the guided flows in under 5 minutes combined, without outside help or documentation.
- **SC-003**: In usability testing, at least 90% of non-technical participants can correctly explain what an on-screen error message means and what to do next, without seeing any raw technical detail.
- **SC-004**: All application screens are fully operable, with no horizontal scrolling or obscured controls, at viewport widths ranging from 360px to large desktop monitors.
- **SC-005**: The application's displayed color appearance matches the operating system's light/dark setting in 100% of sessions, including when that setting changes while the app remains open.
- **SC-006**: In a comparison against the prior interface, at least 90% of surveyed users describe the redesigned UI as modern and easy to use.
- **SC-007**: Abandoning any of the three guided flows partway through never results in a partially-created account, device, or action being visible afterward, across repeated testing.
- **SC-008**: An automated accessibility audit of every screen reports zero WCAG 2.1 Level AA violations, in both light and dark appearance.

## Assumptions

- The redesign is a presentation- and interaction-layer overhaul of the existing FluxIP frontend; it does not introduce new data, business capabilities, or backend behavior beyond what is described in the existing FluxIP Core specification.
- All screens currently in the application (account/onboarding, Trigger Devices, Actions, execution history, notification settings) are in scope for the visual and interaction redesign; only the three named areas (onboarding, Trigger Device creation, Action configuration) become multi-step guided flows — every other existing screen keeps a direct, single-step interaction shape.
- User-facing text remains in the same language the application currently uses (English), reworded where necessary to remove technical jargon; adding new languages or a language switcher is out of scope for this iteration.
- "Modern, neutral" visual design has no existing brand reference to follow; concrete design decisions (typography, color palette, spacing) are determined during the design/planning phase, guided only by the constraint that the result must look contemporary and consistent, and must support both a light and a dark appearance.
- Accessibility conformance is scoped to WCAG 2.1 Level AA (see FR-020/SC-008); support for assistive technologies beyond what that level requires is out of scope for this iteration.
- Guided flows do not need to persist partial progress across browser sessions (e.g., closing the tab and returning later); abandoning a flow simply means starting over, per the Edge Cases above.
- The set of existing account, Trigger Device, Action, notification, and execution-history capabilities is unchanged by this feature — this is a redesign of how those capabilities are presented and navigated, not a change to what they do.
