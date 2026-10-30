<!--
Sync Impact Report
- Version change: 1.2.0 → 1.3.0
- Modified principles:
  - III. Web UI UX Standards: III.2 (tab styling and width, breadcrumbs cover
    the active sub-page) and III.3 (primary CTA shares the tab-bar row)
- Added sections: none
- Removed sections: none
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (Constitution Check references this file generically; no changes needed)
  - ✅ .specify/templates/spec-template.md (no changes needed)
  - ✅ .specify/templates/tasks-template.md (no changes needed)
- Existing frontend likely to need changes (not part of this amendment; separate work):
  - frontend/src/components/layout/AppShell.tsx: top nav also lists Notifications and Account (principle names Devices, Credentials, Agents); check nav link touch targets (min. 44x44px on mobile)
  - frontend/src/pages/*.tsx: every page has an h1 (Actions, "Device — History", "Device — settings", ...); on detail pages replace with breadcrumbs + tabs (Actions, History, Settings) and drop redundant titles
  - frontend/src/pages/Actions.tsx: History/Settings header buttons become tabs; "Add action" moves to the top right, FAB on mobile; card actions Edit/Disable left, Detach right, gap >= 12px
  - frontend/src/components/ui/button.tsx: sizes h-9/h-10/size-10 are below 44px; add a mobile minimum size
  - frontend/src/pages/{IpClients,Credentials,TraefikProviders}.tsx: primary CTAs top right, FAB on mobile; group card/row actions into safe vs. danger
  - frontend/src/flows/*: wizards exist; check mobile usability
  - frontend/src/lib/breadcrumbs.ts, components/layout/Breadcrumbs.tsx: exist; check coverage of all detail pages
- 1.3.0 implementation: NavTabs, DeviceLayout, PageHeader and lib/breadcrumbs.ts
  already follow the amended rules for device pages; docs/development.md
  describes them (no change needed). Open: /actions/:id/executions sits outside
  DeviceLayout, its action stays in the page header.
- Follow-up TODOs:
  - TODO(ADDITIONAL_PRINCIPLES): Add further principles (e.g. testing discipline, architecture constraints) as they are decided.

Previous reports: 1.2.0 (2026-10-30) added Principle III (Web UI UX Standards);
1.1.0 (2026-10-29) added Principle II (Twelve-Factor Compliance);
1.0.0 (2026-07-23) initial ratification with Principle I and Governance.
-->

# FluxIP Constitution

## Core Principles

### I. Explicit Commit Authorization

Git commits MUST NOT be created automatically upon completing a task, a
feature, or any other unit of work. A commit MUST only be created when the
user explicitly instructs it.

When a commit is requested, the assistant MUST first inspect the current
diff and the project's recent commit history (e.g. `git log --oneline -10`)
to identify the project's existing commit-message style, then compose a
commit message that follows the Conventional Commits convention (`feat:`,
`fix:`, `chore:`, `refactor:`, `docs:`, etc.) derived from that diff and
style — rather than asking the user to dictate the wording.

**Rationale**: Automatic commits create an unreviewable, unintentional
history and risk committing incomplete or exploratory work. Requiring an
explicit request keeps the commit history deliberate. Deriving the message
from the actual diff and prior style — instead of prompting the user for
wording — keeps the workflow low-friction while still producing consistent,
convention-following history.

### II. Twelve-Factor Compliance

New and changed code MUST comply with the Twelve-Factor App criteria
(https://12factor.net). Concretely:

- **Config**: Configuration MUST come only from environment variables and
  MUST be validated at startup. Production code paths MUST NOT carry
  development defaults for secrets or hosts.
- **Backing services**: Postgres, Redis, SMTP, Logto and similar services
  MUST be attached only via URLs or host/port values from the environment
  and MUST be replaceable without code changes.
- **Logs**: Logs MUST be written as an event stream to stdout. The
  application MUST NOT write or rotate log files itself.
- **Processes**: Processes MUST be stateless; shared state lives only in
  Postgres or Redis. Process-local caches are allowed only if they can be
  rebuilt without loss.
- **Port binding and concurrency**: The application MUST bind its own ports
  (configurable via the environment), and process types (web, worker) MUST
  be separable and independently scalable.
- **Disposability**: Startup MUST be fast. On SIGTERM the application MUST
  shut down gracefully (close the HTTP server, queues and connections)
  within a bounded timeout.
- **Build, release, run**: Stages MUST be strictly separated. Dependencies,
  base images and CI actions MUST be pinned, and the same image MUST run in
  every environment.
- **Admin processes**: Tasks such as database migrations MUST run as
  one-off processes, not implicitly at web process start.
- **Dev/prod parity**: Development, test and production MUST use the same
  kinds of backing services.

Existing known deviations are tracked in `docs/12-factor-backlog.md`. New
work MUST NOT worsen them; fixing them is done as separate features. The
"Constitution Check" in every plan MUST verify this principle, and any
justified violation MUST be recorded in the plan's Complexity Tracking.

**Rationale**: The application is deployed as container images behind a
reverse proxy and has to run in several environments and, eventually, as
several replicas. The twelve-factor rules keep configuration, state, logging
and operations compatible with that, and a checked backlog stops the
existing deviations from growing.

### III. Web UI UX Standards

The web UI MUST support desktop and mobile equally. New and changed UI MUST
follow these rules.

**1. Core stance**

- **Accessible to semi-technical users**: Copy MUST be clear and
  understandable; expert technical metrics appear alongside it, not instead
  of it. Complex setup flows (e.g. creating rule configurations) MUST be
  built as a multi-step wizard, not as a large single-page form.
- **Mobile-first for core tasks**: The UI MUST be fully responsive. The quick
  overview and critical operations (managing existing connections, reviewing
  logs) MUST be usable one-handed with the thumb on mobile viewports.
- **Isolate actions**: Destructive or high-impact actions (e.g. firewall
  overrides, detaching infrastructure) MUST be visually separated from
  everyday safe changes (e.g. editing a description, temporarily disabling a
  feature).

**2. Navigation and structure**

- **Global top navigation**: App-wide entry points (Devices, Credentials,
  Agents) MUST live in a persistent horizontal top bar.
- **Breadcrumbs**: Detail and child pages MUST show a breadcrumb chain that
  reflects every level of the hierarchy, including the active sub-page or
  tab of a detail view (e.g. Devices / [Device] / Actions). Parent levels
  MUST be links; the current level is plain text.
- **Tabs over headings**: Sub-sections of an object (e.g. Actions, History,
  Settings) MUST be horizontal tabs directly below the breadcrumbs. The
  active tab MUST be marked by an underline in the primary (call-to-action)
  colour, and the tab bar MUST be only as wide as its entries. Large page
  titles that repeat the active tab's name are prohibited.

**3. Placement and calls to action**

- **Primary CTA top right**: Primary actions that complete a flow or open a
  global contextual dialog (e.g. "+ Add an action") MUST sit at the top
  right of the desktop content area. On pages with a tab bar they MUST sit
  at the right end of the tab bar's row; on pages without tabs, top right
  in the page header.
- **Mobile floating action button**: Below 768px, the primary CTA that starts
  a wizard MUST become a sticky, bottom-anchored element (floating action
  button).
- **Actions in cards**: Safe actions (e.g. Edit, Disable) MUST be placed at
  the bottom left of the card. Destructive actions (e.g. Detach, Delete)
  MUST be placed at the bottom right and MUST use the semantic danger tokens
  (high-contrast red).

**4. Touch targets and spacing**

- All interactive elements (buttons, links, tab items) MUST be at least
  44x44px on mobile screens.
- Buttons in a row MUST have at least 12px spacing. Destructive options MUST
  NOT directly adjoin a regular control.

The Constitution Check of every plan that touches the UI MUST verify this
principle; justified deviations are recorded in the plan's Complexity
Tracking. Deviations in the existing frontend are addressed as separate work;
new deviations MUST NOT be introduced.

**Rationale**: FluxIP is used by people with varying technical backgrounds,
often on a phone. Consistent navigation, predictable placement of actions and
a clear separation of dangerous actions reduce operating errors, especially
for changes that affect DNS, firewall and allow-lists.

## Governance

This constitution supersedes all other informal practices or ad hoc
instructions when they conflict with a ratified principle. Amendments are
made by editing this file directly: propose the change, update the
Sync Impact Report at the top of this file, bump `CONSTITUTION_VERSION`
according to semantic versioning (MAJOR for backward-incompatible
principle removals/redefinitions, MINOR for new principles or materially
expanded guidance, PATCH for clarifications and wording fixes), and update
`Last Amended` to the date of the change.

Any Spec Kit artifact (spec, plan, tasks, or template) that conflicts with
a ratified principle MUST be updated in the same change that introduces or
amends the principle — see the Sync Impact Report above for the templates
already checked as part of this ratification.

Compliance with this constitution is expected in every session; when
guidance here and an ad hoc request conflict, this file governs unless the
user explicitly overrides it for that instance.

**Version**: 1.3.0 | **Ratified**: 2026-07-23 | **Last Amended**: 2026-10-30
