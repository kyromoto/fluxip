# Implementation Plan: End-User UI Redesign

**Branch**: `003-end-user-ui-redesign` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-end-user-ui-redesign/spec.md`

## Summary

A visual and interaction-flow redesign of the existing `frontend/` SolidJS application: a modern, neutral component system (Kobalte primitives + Tailwind CSS + Solid UI components copied into the repo via its CLI), automatic OS-driven dark/light appearance via Tailwind's `media` dark-mode strategy (no toggle, no extra JS), three new multi-step guided wizards (account onboarding, Trigger Device creation, Action configuration) built on a small shared `WizardShell`, and a plain-language content/error layer applied to every existing screen. Registration credentials continue to be created by Logto's hosted sign-up page exactly as today; the "onboarding wizard" is a native, in-app sequence of steps that runs on a brand-new user's first authenticated return to the app (detected via a per-account local-storage flag, no backend change). No backend endpoint, data model, or business capability changes.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js ≥22 (existing `frontend/` package, unchanged).

**Primary Dependencies**: SolidJS 1.9 + `@solidjs/router` 0.15 (existing, unchanged). New: `@kobalte/core` (accessible unstyled primitives), Tailwind CSS 3.x + `postcss` + `autoprefixer` (styling), Solid UI components copied into `src/components/ui/` via the `solidui-cli` (not installed as a library dependency), `class-variance-authority` + `tailwind-merge` + `clsx` (Solid UI's standard styling-utility peers). `@logto/browser` (existing, unchanged — still owns the hosted sign-up/sign-in redirect). New dev-only: `@solidjs/testing-library` (component tests), Playwright + `@axe-core/playwright` (responsive-viewport and WCAG 2.1 AA automated audits, since no browser-based test runner exists in the repo yet and SC-004/SC-008 need real layout/contrast rendering, not jsdom).

**Storage**: N/A for this feature. Existing Postgres-backed backend and its event-sourced aggregates are untouched. The only new client-side state is a per-account `localStorage` flag marking the onboarding wizard as seen/completed (not sent to the backend).

**Testing**: Vitest (existing, both packages) for component/unit-level logic (wizard step-state hook, error-message mapping). New Playwright suite for: (a) automated WCAG 2.1 AA audits of every screen in both light and dark appearance (SC-008), (b) layout checks at the 360px floor and a large-desktop width with no horizontal scroll (SC-004/FR-016), (c) happy-path smoke runs of the three guided wizards. Timed usability criteria (SC-001, SC-002, SC-006) are manual/moderated usability-test criteria, not automated tests, and are out of scope for the automated suite.

**Target Platform**: Web (evergreen desktop + mobile browsers), served by the existing Vite build (`vite build` → static `dist/`) behind the existing reverse proxy; no change to how the frontend is built or deployed.

**Project Type**: Web application — existing `backend/` + `frontend/` pnpm workspace. This feature is entirely scoped to `frontend/`; `backend/` is not touched.

**Performance Goals**: No new numeric performance target beyond existing SPA expectations; dark/light appearance changes must apply via CSS alone (no visible flash, no re-render-driven delay) and wizard step transitions must feel immediate (no perceptible loading state for pure client-side navigation between steps).

**Constraints**: Must stay on SolidJS + `@solidjs/router` (FR-017, non-goal: no framework/routing change). No manual dark/light toggle (non-goal). No new backend endpoints, database tables, or business capabilities (spec Assumptions). Minimum supported viewport width 360px (FR-016). WCAG 2.1 Level AA (FR-020).

**Scale/Scope**: One frontend package. Six existing screens restyled in place (`IpClients`, `Actions`, `Account`, `NotificationSettings`, `ExecutionHistory`, `Callback`) plus three new wizard flows and one shared post-login onboarding flow.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` defines a single ratified principle: **Explicit Commit Authorization** (commits must never be created automatically; only on explicit user request, using Conventional Commits derived from the diff and prior history). This is a process rule for the assistant, not a design constraint — it does not gate any technical decision in this plan. No other principles are defined. No violations; nothing to record in Complexity Tracking.

**Post-design re-check**: Phase 1 design adds new frontend-only dev/runtime dependencies (Kobalte, Tailwind, Solid UI's copied components, Playwright) and no backend surface at all. Still no gates to fail, and no commits are made as part of this planning work.

## Project Structure

### Documentation (this feature)

```text
specs/003-end-user-ui-redesign/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/            # UNCHANGED by this feature

frontend/
├── components.json           # NEW — solidui-cli config (import alias, tailwind path, css path)
├── tailwind.config.ts        # NEW
├── postcss.config.js         # NEW
├── src/
│   ├── app.css                     # NEW — Tailwind directives + light/dark CSS variables
│   ├── components/
│   │   ├── ui/                     # NEW — Solid UI components copied in via `solidui-cli add` (button, dialog, input, select, checkbox, card, progress, alert, label, form, …)
│   │   ├── layout/
│   │   │   ├── AppShell.tsx        # NEW — replaces the ad-hoc Layout() in App.tsx; nav + responsive frame
│   │   │   └── EmptyState.tsx      # NEW — FR-019 shared empty-list message + call-to-action
│   │   └── feedback/
│   │       └── ErrorMessage.tsx    # NEW — renders the plain-language mapped error (FR-013/014/015)
│   ├── flows/
│   │   ├── wizard/
│   │   │   ├── WizardShell.tsx     # NEW — shared step indicator + back/next/cancel chrome (FR-008/009/010)
│   │   │   └── useWizard.ts        # NEW — step-state hook: current step, per-step data, validation gate
│   │   ├── onboarding/             # NEW — User Story 1 (post-login first-run steps; credential creation stays on Logto's hosted page)
│   │   ├── device-wizard/          # NEW — User Story 2 (replaces the inline "register" form in IpClients.tsx)
│   │   └── action-wizard/          # NEW — User Story 3 (replaces the inline "attach" form in Actions.tsx)
│   ├── lib/
│   │   ├── cn.ts                   # NEW — Solid UI's class-merge utility
│   │   ├── errors.ts               # NEW — raw error/status → plain-language message mapping
│   │   └── onboarding-state.ts     # NEW — per-account localStorage "has completed onboarding" helper
│   ├── pages/                      # EXISTING, restyled in place; IpClients/Actions launch the new wizards instead of inline forms
│   │   ├── IpClients.tsx
│   │   ├── Actions.tsx
│   │   ├── Account.tsx
│   │   ├── NotificationSettings.tsx
│   │   ├── ExecutionHistory.tsx
│   │   └── Callback.tsx
│   ├── services/                   # EXISTING (api.ts, auth.ts) — unchanged
│   ├── App.tsx                     # MODIFIED — mounts AppShell, gates onboarding flow post-login
│   └── main.tsx                    # EXISTING — unchanged
└── tests/
    ├── unit/                       # NEW — Vitest + @solidjs/testing-library
    └── e2e/                        # NEW — Playwright (axe audits, 360px/desktop layout, wizard smoke paths)
```

**Structure Decision**: Single existing "web application" layout (`backend/` + `frontend/` pnpm workspace) is retained unchanged; this feature lives entirely inside `frontend/src`, adding a `flows/` directory for the three guided wizards and their shared shell, a `components/ui/` directory for Solid UI's repo-local (copied, not installed) primitives, and a `tests/` split between fast component tests (Vitest) and real-browser layout/accessibility/wizard-smoke tests (Playwright). No `backend/` change and no new top-level project.

## Complexity Tracking

*No entries — Constitution Check reported no violations.*
