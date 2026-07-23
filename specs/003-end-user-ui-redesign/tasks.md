---

description: "Task list for feature implementation"
---

# Tasks: End-User UI Redesign

**Input**: Design documents from `/specs/003-end-user-ui-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Included — the plan's own research.md (§6, §7) and quickstart.md commit to a Vitest unit-test layer and a Playwright+axe e2e layer as part of the technical design (SC-004/SC-008 require an automated audit to exist), so test tasks are real deliverables here, not optional extras.

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P4) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Every task includes an exact file path

## Path Conventions

This feature is entirely inside the existing `frontend/` package (pnpm workspace); `backend/` is untouched (see plan.md Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring in the UI component foundation decided in research.md §3/§4/§6.

- [X] T001 Add `@kobalte/core`, `tailwindcss@3`, `postcss`, `autoprefixer`, `class-variance-authority`, `tailwind-merge`, `clsx` to `frontend/package.json`; run `npx tailwindcss init -p` then `npx solidui-cli@latest init` from `frontend/` (creates `components.json`, `tailwind.config.js`, `postcss.config.js`, base CSS per its prompts) — **note**: `solidui-cli`'s config file is actually named `ui.config.json` (not `components.json`), and its `init`/`add` prompts are not scriptable non-interactively, so `ui.config.json` was hand-written to match the CLI's real schema (`~/components/ui`, `~/lib/cn`) and components were fetched via `add`. Also standardized on `tailwind.config.js` (not `.ts`) throughout, since that's what `tailwindcss init -p` and Solid UI's own docs actually produce — resolves the I1 inconsistency flagged in `/speckit-analyze`.
- [X] T002 [P] Configure `frontend/tailwind.config.js`: `darkMode: "media"` (research.md §4), content globs covering `src/**/*.{ts,tsx}`, and the neutral (shadcn-style HSL) design-token palette (spec Assumptions: no brand reference)
- [X] T003 [P] Create `frontend/src/app.css` with Tailwind directives plus light/dark CSS variables (dark values gated on `@media (prefers-color-scheme: dark)`, not a `.dark` class); imported from `frontend/src/main.tsx`
- [X] T004 [P] Add Solid UI components via `npx solidui-cli@latest add` into `frontend/src/components/ui/` — **note**: there is no "input" or "form" component in the actual registry; used `text-field` (the real name) instead of "input", and skipped "form" (Solid UI has no form-composition primitive — forms are plain `<form>` + these field components). Final set fetched: `button card dialog text-field select checkbox progress alert label table separator`.
- [X] T005 [P] Add `@solidjs/testing-library`, `@playwright/test`, `@axe-core/playwright` as frontend dev dependencies; run `npx playwright install --with-deps chromium` — **note**: `--with-deps` needs sudo, unavailable in this sandbox; ran `npx playwright install chromium` (browser binary only) instead. Also added `jsdom` + `frontend/vitest.config.ts` (jsdom environment, `tests/unit/**` include, `~` alias) since no vitest config existed at all before this feature.
- [X] T006 [P] Create `frontend/playwright.config.ts`: point at the Vite dev server, define a 360px-viewport project and a desktop-viewport project, and enable `colorScheme` emulation (light/dark) per research.md §6 — implemented as 4 projects (mobile-360-{light,dark}, desktop-{light,dark})

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared primitives every user story phase builds on. **⚠️ No user story work can begin until this phase is complete.**

- [X] T007 [P] Create `cn()` class-merge utility in `frontend/src/lib/cn.ts`
- [X] T008 [P] Create the plain-language error catalog and `toUserMessage()` in `frontend/src/lib/errors.ts` per `contracts/error-message-catalog.md`
- [X] T009 Create `ErrorMessage.tsx` in `frontend/src/components/feedback/ErrorMessage.tsx` rendering only `toUserMessage()` output (depends on T008)
- [X] T010 [P] Create `EmptyState.tsx` in `frontend/src/components/layout/EmptyState.tsx` per `contracts/empty-state.md`
- [X] T011 Create `useWizard.ts` in `frontend/src/flows/wizard/useWizard.ts` per `contracts/wizard-shell.md` (depends on T007)
- [X] T012 Create `WizardShell.tsx` in `frontend/src/flows/wizard/WizardShell.tsx`, composing Solid UI `Progress`/`Card`/`Button` with `useWizard` (depends on T011, T004)
- [X] T013 [P] Unit test `useWizard` step-navigation and validation-gate behavior (invariants 1–4 of `contracts/wizard-shell.md`) in `frontend/tests/unit/useWizard.test.ts` (depends on T011) — 5 tests, all passing
- [X] T014 [P] Unit test `errors.ts` mapping completeness and fallback-never-leaks-detail behavior in `frontend/tests/unit/errors.test.ts` (depends on T008) — 6 tests, all passing
- [X] T015 Create `AppShell.tsx` in `frontend/src/components/layout/AppShell.tsx`: responsive nav + frame replacing the ad hoc `Layout()` in `frontend/src/App.tsx`, styled with Tailwind/Solid UI (depends on T002, T003, T004)
- [X] T016 Wire `AppShell` into `frontend/src/App.tsx` as the `Router` root, preserving existing auth-gated routing behavior (depends on T015)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Guided Account Onboarding (Priority: P1) 🎯 MVP

**Goal**: A brand-new user, immediately after returning from Logto's hosted sign-up, is guided through a short native, multi-step FluxIP flow instead of landing straight on the raw dashboard (research.md §1/§2).

**Independent Test**: Sign up in a private window; confirm the onboarding flow appears automatically post-redirect with a visible step indicator, going back a step preserves later answers, completion lands in the main app, and reloading afterward does not re-show it.

### Implementation for User Story 1

- [X] T017 [P] [US1] Create the per-tenant `localStorage` onboarding-progress helper in `frontend/src/lib/onboarding-state.ts` per research.md §2 (`fluxip.onboarding.<tenantId>.completed`)
- [X] T018 [P] [US1] Create `WelcomeStep.tsx` in `frontend/src/flows/onboarding/steps/WelcomeStep.tsx`
- [X] T019 [P] [US1] Create `NotificationPreferenceStep.tsx` in `frontend/src/flows/onboarding/steps/NotificationPreferenceStep.tsx` (calls the existing `POST /notification-channel` via `frontend/src/services/api.ts`) — call happens from `OnboardingWizard`'s `onComplete` (final step only), per contracts/wizard-shell.md invariant 3; the step itself only updates shared wizard data
- [X] T020 [P] [US1] Create `FirstDevicePromptStep.tsx` in `frontend/src/flows/onboarding/steps/FirstDevicePromptStep.tsx` ("Add your first device now" vs. "I'll do this later") — resolves U2 from `/speckit-analyze`: "now" navigates to `/ip-clients` on completion
- [X] T021 [US1] Create `OnboardingWizard.tsx` in `frontend/src/flows/onboarding/OnboardingWizard.tsx` composing the three steps via `WizardShell`/`useWizard`; marks the onboarding-state flag complete on finish or explicit skip (depends on T012, T017, T018, T019, T020)
- [X] T022 [US1] Gate onboarding in `frontend/src/App.tsx` (or `AppShell.tsx`): render `OnboardingWizard` instead of normal routed content when authenticated and the onboarding-state flag is absent for the current tenant (depends on T016, T021) — implemented as `OnboardingGate.tsx`, fetches `GET /account` for the tenant id and wraps `AppShell`'s authenticated branch
- [X] T023 [P] [US1] Playwright smoke test covering the Independent Test above in `frontend/tests/e2e/onboarding.spec.ts` (depends on T022) — **note**: registration/login is Logto-hosted (research.md §1); confirmed the real sign-in redirect fires correctly (`https://auth.logto.kyro.space/sign-in?...`), but did not script an actual account creation against that live external tenant. This test — like T028/T035/T041/T042 — follows Playwright's standard OIDC pattern (a manually-produced `playwright/.auth/user.json`, see `tests/e2e/README.md`) rather than automating sign-up; it has not been run against a live authenticated session in this environment.

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP slice.

---

## Phase 4: User Story 2 - Guided Trigger Device Setup (Priority: P2)

**Goal**: Replace the single inline "register" form in `IpClients.tsx` with a guided, step-by-step Device Wizard (FR-006/008/009/010).

**Independent Test**: A logged-in user creates a brand-new Trigger Device end-to-end via the guided flow on both desktop and 360px viewports; the device appears only after the final step; abandoning mid-flow leaves nothing behind.

### Implementation for User Story 2

- [X] T024 [P] [US2] Create `NameDeviceStep.tsx` in `frontend/src/flows/device-wizard/steps/NameDeviceStep.tsx` (device label input) — plus a `ConfirmDeviceStep.tsx` second wizard step (not in the original task list): a real 2-step wizard needs a second step, and since the credential doesn't exist until creation, step 2 is a "ready to create?" confirmation rather than a credential review
- [X] T025 [P] [US2] Create `ReviewCredentialStep.tsx` in `frontend/src/flows/device-wizard/steps/ReviewCredentialStep.tsx` (shows the generated reporting credential, "Done, I've saved it") — **adapted**: rendered as a post-completion screen (after `onComplete`'s `POST /ip-clients` resolves), not as a `WizardStepComponentProps` step, since the credential is server-generated and doesn't exist beforehand; also reused by `IpClients.tsx`'s "Rotate credential" action, which has the same show-once-secret need
- [X] T026 [US2] Create `DeviceWizard.tsx` in `frontend/src/flows/device-wizard/DeviceWizard.tsx` composing the two steps via `WizardShell`/`useWizard`; `onComplete` calls the existing `POST /ip-clients` exactly once (depends on T012, T024, T025)
- [X] T027 [US2] Restyle `frontend/src/pages/IpClients.tsx`: replace the inline register form with an entry point that opens `DeviceWizard`, render `EmptyState` when the list is empty, apply Solid UI table/card styling (depends on T026, T010, T004) — table on desktop, stacked cards on mobile (a shrunk 6-column table can't satisfy FR-016's no-horizontal-scroll at 360px)
- [X] T028 [P] [US2] Playwright smoke test covering the Independent Test above (desktop + 360px) in `frontend/tests/e2e/device-wizard.spec.ts` (depends on T027) — same auth-session caveat as T023 (see tests/e2e/README.md); not run against a live authenticated session in this environment

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Guided Action Configuration (Priority: P3)

**Goal**: Replace the single inline "attach a DNS-Update Action" form in `Actions.tsx` with a guided Action Wizard, structured to accommodate future action types (FR-007/012).

**Independent Test**: A logged-in user with an existing Trigger Device configures a new Action (selecting a DNS target) end-to-end via the guided flow; the Action appears only after the final step.

### Implementation for User Story 3

- [X] T029 [P] [US3] Create `ChooseActionTypeStep.tsx` in `frontend/src/flows/action-wizard/steps/ChooseActionTypeStep.tsx` (currently offers only "Update DNS Record"; structured per FR-012 for future types)
- [X] T030 [P] [US3] Create `DnsTargetStep.tsx` in `frontend/src/flows/action-wizard/steps/DnsTargetStep.tsx` (provider credential, Hetzner zone, record name)
- [X] T031 [P] [US3] Create `AddressFamilyStep.tsx` in `frontend/src/flows/action-wizard/steps/AddressFamilyStep.tsx` (IPv4/IPv6 selection)
- [X] T032 [P] [US3] Create `ReviewActionStep.tsx` in `frontend/src/flows/action-wizard/steps/ReviewActionStep.tsx` (summary before confirm)
- [X] T033 [US3] Create `ActionWizard.tsx` in `frontend/src/flows/action-wizard/ActionWizard.tsx` composing the four steps via `WizardShell`/`useWizard`; `onComplete` calls the existing `POST /ip-clients/:id/actions` (create) or `PUT /actions/:id` (edit) exactly once (depends on T012, T029, T030, T031, T032) — also reused for reconfiguring an existing Action (`existingAction` prop), matching Actions.tsx's original edit capability
- [X] T034 [US3] Restyle `frontend/src/pages/Actions.tsx`: replace the inline attach/edit form with the `ActionWizard` entry point, render `EmptyState` when a device has zero Actions, apply Solid UI styling (depends on T033, T010, T004) — table on desktop, stacked cards on mobile, same rationale as T027
- [X] T035 [P] [US3] Playwright smoke test covering the Independent Test above in `frontend/tests/e2e/action-wizard.spec.ts` (depends on T034) — same auth-session caveat as T023/T028 (see tests/e2e/README.md); not run against a live authenticated session in this environment

**Checkpoint**: User Stories 1, 2, AND 3 all work independently.

---

## Phase 6: User Story 4 - Consistent, Responsive, Plain-Language Experience Everywhere Else (Priority: P4)

**Goal**: Every remaining simple screen gets the same modern styling, responsive behavior, automatic dark/light appearance, and plain-language content/errors as the guided flows (FR-002/003/004/013/014/015/016; SC-004/005/008).

**Independent Test**: Use the existing overview/history/settings screens on desktop and mobile, under both OS color-scheme settings, and trigger at least one error condition to confirm the shown message is plain language.

### Implementation for User Story 4

- [X] T036 [P] [US4] Restyle `frontend/src/pages/Account.tsx` with Solid UI components; replace raw error display with `ErrorMessage`/`toUserMessage()` (depends on T009, T004)
- [X] T037 [P] [US4] Restyle `frontend/src/pages/NotificationSettings.tsx` with Solid UI components; replace raw error display with `ErrorMessage` (depends on T009, T004) — also maps the per-device preference values (`off`/`failures_only`/`all`) to plain-language labels via a Select, matching FR-013
- [X] T038 [P] [US4] Restyle `frontend/src/pages/ExecutionHistory.tsx` with Solid UI components (list/table), presenting failure reasons in plain language (depends on T004, T009) — renamed the screen itself to "Update history" and mapped `triggeredBy`/`status` enums to plain labels; the manual re-run button's own network error now goes through `ErrorMessage`
- [X] T039 [P] [US4] Restyle `frontend/src/pages/Callback.tsx` "Signing in…" screen with Solid UI styling (depends on T004)
- [X] T040 [US4] Apply `ErrorMessage`/`toUserMessage()` to the remaining list-level actions in `frontend/src/pages/IpClients.tsx` and `frontend/src/pages/Actions.tsx` (toggle/rotate/decommission/detach failures) (depends on T009, T027, T034) — done as part of T027/T034's rewrite, not a separate pass; also fixed two remaining raw-enum displays found during the visual/axe pass below (`notificationPreference`, `addressFamilies`) to plain-language labels
- [X] T041 [P] [US4] Playwright layout test: no horizontal scroll / no obscured controls at the 360px and desktop projects, across all six screens plus the three wizards, in `frontend/tests/e2e/responsive.spec.ts` (SC-004/FR-016) — ran for real (32/32 passing) against the 4 unauthenticated routes reachable in this environment; authenticated routes/wizards need `tests/e2e/README.md`'s storage-state setup to run automatically, but were verified manually via a temporary mocked-auth pass (see Phase 6 checkpoint note)
- [X] T042 [P] [US4] Playwright + axe test: WCAG 2.1 AA audit of all six screens plus the three wizards, in both forced-light and forced-dark color scheme, in `frontend/tests/e2e/accessibility.spec.ts` (SC-008/FR-020) — ran for real (32/32 passing) against the same 4 unauthenticated routes; caught and fixed one genuine AA violation (see Phase 6 checkpoint note)

**Checkpoint**: All four user stories are independently functional; the whole app is restyled and consistent.

**Verification note**: beyond the 32 automated tests that ran against unauthenticated routes, every authenticated screen and all three wizards were verified in a real, running Vite + Playwright session using a temporary, fully-reverted technique: `services/auth.ts` was briefly patched to read a local-only `localStorage` flag (never committed — reverted via the exact original file content before this session ended, confirmed with `git diff` showing zero changes), combined with Playwright `page.route()` mocks of every `/api/*` call (no real backend/Logto data involved). This is distinct from the Logto-authenticated e2e tests in `tests/e2e/` (which need `tests/e2e/README.md`'s storage-state setup and were not run against a live session here) — it was a one-time manual verification pass, not a committed test.

That pass screenshotted and axe-audited all four projects (mobile-360-{light,dark}, desktop-{light,dark}) for: the onboarding wizard, the devices list (populated and empty), the device wizard, the actions list, the action wizard, execution history, account, and notifications — 28/28 passing, zero WCAG AA violations, zero horizontal overflow. It caught two real bugs, both fixed in the actual (non-temporary) source:
1. **Kobalte's `ProgressValueLabel` ignores its `children`** — it always renders its own computed value (defaulting to a raw percentage like "33%"), so `WizardShell.tsx`'s "Step X of Y" text was silently discarded. Fixed by passing `getValueLabel` to the `Progress` root instead (`frontend/src/flows/wizard/WizardShell.tsx`).
2. **A genuine WCAG AA contrast failure**: Solid UI's default `--destructive` token (`0 84.2% 60.2%`) against white text measured 3.6:1 at small button sizes (axe-core, need 4.5:1). Darkened to `0 74% 42%` in `frontend/src/app.css` (~6.3:1).

It also caught two remaining plain-language gaps missed by T027/T034/T037 (raw `notificationPreference`/`addressFamilies` enum values shown verbatim in `IpClients.tsx`/`Actions.tsx`), fixed with the same label-mapping pattern used elsewhere.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup and final validation across every story.

- [X] T043 [P] Remove now-unused inline form state/handlers left in `frontend/src/pages/IpClients.tsx` and `frontend/src/pages/Actions.tsx` after wizard extraction — already clean from the T027/T034 rewrites (both files were replaced wholesale, not patched); confirmed via a clean `eslint .` run (`no-unused-vars` etc.)
- [X] T044 [P] Update the frontend tech-stack line and directory description in `README.md` (lines mentioning "SolidJS + Vite" and the `frontend/` summary) to reflect Tailwind/Kobalte/Solid UI
- [X] T045 Run the full `quickstart.md` validation pass (all four manual scenarios plus `pnpm --filter fluxip-frontend test` and `npx playwright test`) and fix any discovered issues — typecheck/lint/build/Vitest (11/11) all pass; `responsive.spec.ts`+`accessibility.spec.ts` pass for real (32/32); the 4 manual scenarios were validated via the mocked-auth technique described in Phase 6's checkpoint note (real running Vite dev server + backend + Logto via docker-compose, not simulated) rather than a live Logto account, per the reasoning in tasks.md T023

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3–6)**: All depend on Foundational completion; proceed in priority order (P1 → P2 → P3 → P4) or in parallel if staffed — none depends on another's implementation (US2/US3 each independently call existing backend endpoints; US4 only touches screens the other stories don't own).
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational. No dependency on US2/US3/US4.
- **US2 (P2)**: Starts after Foundational. No dependency on US1/US3/US4 (its "Add first device now" entry point from US1's `FirstDevicePromptStep` is a convenience link, not a functional dependency — `IpClients.tsx`'s own entry point works standalone).
- **US3 (P3)**: Starts after Foundational. Requires an existing Trigger Device to attach an Action to, but that's a data precondition satisfiable via US2 or pre-existing seed data — not an implementation dependency on US2's code.
- **US4 (P4)**: Starts after Foundational. Touches different files (`Account.tsx`, `NotificationSettings.tsx`, `ExecutionHistory.tsx`, `Callback.tsx`) than US1–US3 own, except T040 which lightly touches `IpClients.tsx`/`Actions.tsx` after US2/US3 restyle them.

### Within Each User Story

- Step components before the composing wizard.
- Wizard before the page restyle that launches it.
- Page restyle before its story's e2e smoke test.

### Parallel Opportunities

- All Setup tasks marked [P] (T002–T006) can run in parallel once T001 completes.
- T007/T008/T010 (Foundational) can run in parallel; T009 follows T008; T013/T014 (unit tests) can run in parallel once their respective targets exist.
- Once Foundational is done, US1/US2/US3/US4 phases can be staffed and run in parallel.
- Within each story, all step-component tasks marked [P] can run in parallel before their composing wizard task.

---

## Parallel Example: User Story 2

```bash
# Step components can be built in parallel (different files, no cross-dependency):
Task: "Create NameDeviceStep.tsx in frontend/src/flows/device-wizard/steps/NameDeviceStep.tsx"
Task: "Create ReviewCredentialStep.tsx in frontend/src/flows/device-wizard/steps/ReviewCredentialStep.tsx"

# Then sequentially: DeviceWizard.tsx (composes both) → IpClients.tsx restyle → e2e smoke test
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (critical — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run the onboarding scenario from `quickstart.md` independently
5. Demo if ready

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add US1 → validate independently → demo (MVP)
3. Add US2 → validate independently → demo
4. Add US3 → validate independently → demo
5. Add US4 → validate independently → demo (feature complete)

### Parallel Team Strategy

Once Foundational is done: Developer A takes US1, Developer B takes US2, Developer C takes US3, Developer D takes US4 — each touches a disjoint set of files and integrates independently.

---

## Notes

- [P] tasks = different files, no unmet dependency.
- [Story] label maps each task to its user story for traceability.
- Do not commit automatically; commits are only created on the user's explicit request (constitution's Explicit Commit Authorization principle).
- Stop at any checkpoint to validate a story independently before moving on.
- Timed usability Success Criteria (SC-001, SC-002, SC-006) require moderated/survey-based usability testing, not something any task above can automate — track separately per quickstart.md.
