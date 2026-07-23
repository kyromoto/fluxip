# Phase 0 Research: End-User UI Redesign

## 1. Onboarding wizard vs. Logto-owned registration

**Decision**: Keep credential creation (email + password) exactly as today — a full-page redirect to Logto's hosted sign-up/sign-in experience (`logtoClient.signIn()` → `/callback`). The in-app, multi-step "onboarding" guided flow required by FR-005/User Story 1 runs natively inside FluxIP *after* a brand-new user's first authenticated return from that redirect (e.g., a welcome step, a notification-preference step, and a prompt to add the first Trigger Device), using the existing `AppShell`/router — no new backend endpoint.

**Rationale**: `specs/001-ip-change-automation/research.md` §7 already made a deliberate, documented architectural decision that "Logto owns registration/login/password reset entirely; FluxIP never sees or stores a password," and rejected FluxIP-issued sessions. The only precedent for FluxIP calling Logto's Management API (`logto-management-client.ts`) is the password-*change* proxy, which mutates an *existing* user and requires a already-authenticated tenant ID — it has no analog for *creating* a new identity. Building a true native registration form would require a new backend endpoint that creates users via Logto's Management API, which both contradicts that prior decision and this spec's own Assumption that the redesign "does not introduce new data, business capabilities, or backend behavior." Confirmed with the user during planning (see plan session): keep the redirect, add a native post-login first-run wizard.

**Alternatives considered**:
- *True native registration wizard with a new backend user-creation endpoint* — rejected: reverses a settled architectural decision, adds credential-handling surface to the backend, and violates this feature's own "presentation-layer only" scope.
- *Embed Logto's hosted sign-up in an iframe styled as "step 1" of the wizard* — rejected: most OIDC providers (Logto included) block hosted auth pages from being iframed for security reasons (clickjacking protection), and it would still not give FluxIP control over that step's UI/copy.

## 2. Detecting a "brand-new" user for the onboarding flow

**Decision**: A per-tenant flag in `localStorage` (key derived from the Logto `sub`/tenant ID, e.g. `fluxip.onboarding.<tenantId>.completed`). On first authenticated render, if the flag is absent for the current tenant, show the onboarding flow; set the flag once the flow is completed or explicitly dismissed.

**Rationale**: The backend's `AccountService.ensureProvisioned` already runs on *every* authenticated request (via middleware, before any route handler), so by the time the frontend can call `GET /account` the account already exists — there is no request/response moment where the backend can tell the frontend "this account was *just* created." Extending the account response with a timestamp and inferring "new" from "created within the last N minutes" is a fragile heuristic and still a backend response-shape change. A frontend-only flag needs zero backend changes (consistent with this feature's scope), and the spec's own Assumptions section already says guided flows don't need to persist across browser sessions / a returning already-registered user should skip onboarding — a per-browser, per-tenant flag satisfies both without over-engineering a durable "onboarding completed" server-side field for a first iteration.

**Alternatives considered**:
- *Add `registeredAt` to `GET /account` and infer "new" client-side by recency* — rejected: still a (small) backend response change, and a time-window heuristic is strictly worse than an explicit flag.
- *New backend `onboardingCompletedAt` field on the account aggregate* — rejected as unnecessary scope growth for this iteration; would be the natural upgrade path if cross-device consistency is ever required later.

## 3. UI component foundation

**Decision**: `@kobalte/core` for unstyled, accessible primitives (dialog, popover, select, etc. — WAI-ARIA behavior, focus management, keyboard nav) + Tailwind CSS 3.x for styling + Solid UI (`solid-ui.com`) components copied into `frontend/src/components/ui/` via its `solidui-cli` CLI (`npx solidui-cli@latest init`, then `add <component>` per component needed), not installed as an npm library dependency. `class-variance-authority`, `tailwind-merge`, and `clsx` are added as the small set of styling-utility peers Solid UI's copied components expect.

**Rationale**: This exact stack was specified by the user for this planning session. Solid UI is explicitly "not a component library... a collection of re-usable components you copy and paste into your app," built on Kobalte for accessibility and Tailwind for styling — which lines up with FR-020 (WCAG 2.1 AA) coming largely "for free" from Kobalte's ARIA/focus-management behavior, and with the desire to freely restyle a neutral, modern look (spec Assumptions: no existing brand reference) without fighting a fixed library's theming API. Tailwind CSS **3.x** (not 4.x) is what Solid UI's own installation guide currently targets (`darkMode` key in `tailwind.config.js`, PostCSS-based build) — using v4 would require adapting undocumented, unofficial config translations for a copy-pasted component set, which is unnecessary risk for a redesign whose whole point is visual/interaction polish, not a build-tooling upgrade.

**Alternatives considered**:
- *A fixed, installed component library (e.g. a pre-built SolidJS design system as an npm dependency)* — rejected by the user's explicit direction; also harder to restyle freely toward a from-scratch "modern, neutral" look with no brand reference.
- *Tailwind CSS v4* — rejected for now: Solid UI's documented setup targets v3; mixing an unofficial v4 config with copy-pasted v3-oriented components adds avoidable risk. Revisit if/when Solid UI publishes official v4 support.

## 4. Dark/light mode mechanism

**Decision**: `darkMode: "media"` in `tailwind.config.ts`. Every themed style is expressed as a plain Tailwind utility plus its `dark:` variant (e.g. `bg-white dark:bg-neutral-900`); the browser's `prefers-color-scheme` media query drives which variant applies, live, via CSS alone — no JavaScript theme state, no `ColorModeProvider`, no `localStorage` theme manager, no toggle UI.

**Rationale**: FR-003/FR-004/SC-005 require the appearance to match the OS setting automatically, update live if that setting changes while the app is open, and present no manual toggle at all (explicit non-goal). Tailwind's `media` strategy is a pure CSS media-query mechanism: the OS already fires `prefers-color-scheme` changes to the browser, and `dark:` utility classes re-evaluate automatically with zero app-level JS and zero flash-of-wrong-theme risk (there is no stored/guessed theme value to reconcile on load — the browser evaluates the current media query on first paint). Solid UI's own documented dark-mode recipe (`ColorModeProvider` + `createLocalStorageManager` + a dropdown-menu toggle component) is built for the opposite use case — manual/persisted user choice — and is deliberately not used here since it's for a feature this project explicitly excludes.

**Alternatives considered**:
- *Solid UI's `ColorModeProvider`/`createLocalStorageManager` recipe* — rejected: designed for manual toggling and persisted override, which is out of scope (non-goal) for this iteration.
- *`darkMode: "class"` with a `prefers-color-scheme` listener that toggles a root class* — rejected: reintroduces JS state and a possible flash-before-hydration for no benefit over the media strategy, since no manual override is ever needed.

## 5. Wizard shell / step indicator

**Decision**: A small, hand-built `WizardShell` component (in `frontend/src/flows/wizard/`) composing Solid UI's `Progress`, `Card`, and `Button` primitives, plus a `useWizard` hook holding `currentStepIndex`, an ordered step-data bag, and a per-step `canAdvance` validation gate. Each of the three guided flows (onboarding, device creation, action configuration) is a thin config (its ordered list of step components) passed to the same shell.

**Rationale**: Solid UI does not ship a dedicated "stepper"/"wizard" component (confirmed against its published docs); shadcn/ui's own ecosystem treats multi-step flows as an application-level composition of `Progress` + `Card` + `Button`, not a packaged primitive. A single shared shell directly satisfies FR-008 (current step / steps remaining), FR-009 (back navigation without losing valid data), and FR-010 (no partial resource left behind on abandonment — enforced by only calling the real creation/attach API on the final step's confirmation, never per-step) for all three guided flows at once, rather than three divergent implementations.

**Alternatives considered**:
- *Per-flow bespoke step components with no shared shell* — rejected: three independent implementations of the same progress/back/next/abandon-safety behavior is exactly the kind of duplication a shared shell avoids, and would risk the three flows drifting inconsistent in exactly the properties (FR-008/009/010) that must hold for all of them.

## 6. Automated accessibility & responsive-layout verification

**Decision**: Add Playwright plus `@axe-core/playwright` as new frontend dev dependencies. A small e2e suite runs an axe scan against every screen in both a forced-light and forced-dark emulated color scheme (SC-008), and asserts no horizontal overflow / no obscured controls at a 360px viewport and a large desktop viewport (SC-004/FR-016).

**Rationale**: The repo currently has no browser-based test runner (Vitest here runs in jsdom, which cannot faithfully evaluate real layout, contrast rendering, or `prefers-color-scheme` media emulation). SC-004, SC-005, and SC-008 are specifically about real rendered layout and color, which requires a real browser engine. Playwright is the natural choice already familiar in the Node/TypeScript ecosystem this repo is built on, and `@axe-core/playwright` is the standard automated-WCAG-audit pairing for it.

**Alternatives considered**:
- *`vitest-axe`/`jest-axe` against jsdom* — rejected as the sole mechanism: jsdom does not compute real layout or apply CSS media queries the way a browser does, so it cannot validate SC-004/SC-005 and would give an incomplete picture even for SC-008 (no real color contrast rendering).
- *Manual-only verification (no automated a11y/responsive suite)* — rejected: SC-008 explicitly commits to "an automated accessibility audit... reports zero WCAG 2.1 AA violations," which requires an automated tool to exist and run.

## 7. Component-level testing

**Decision**: `@solidjs/testing-library` added alongside the existing Vitest setup, for fast, non-browser tests of `useWizard`'s step-navigation/validation-gate logic and the `errors.ts` plain-language mapping table — logic that doesn't need a real browser to verify correctly.

**Rationale**: Keeps fast feedback for pure logic (step advancement rules, error-mapping completeness) separate from the slower, real-browser Playwright suite reserved for what actually needs a browser (layout, contrast, media queries). Matches the existing repo convention of Vitest for both packages.

**Alternatives considered**: *Testing everything only through Playwright* — rejected: slower feedback loop for logic that has nothing to do with real rendering, and this repo already standardizes on Vitest for unit-level work.

## 8. Plain-language error mapping

**Decision**: A single `frontend/src/lib/errors.ts` module exporting a lookup table from known backend error shapes (HTTP status + the existing `{ error: string }` body shape returned by routes like `account.ts`) to a fixed set of short, user-facing messages, plus one generic fallback message for anything unrecognized. `ErrorMessage.tsx` renders only the mapped text — components stop passing `err.message`/`String(err)` straight into the DOM (the pattern currently used in `Account.tsx`, `IpClients.tsx`, `Actions.tsx`, `NotificationSettings.tsx`).

**Rationale**: FR-013/014/015 require plain language everywhere and explicitly forbid raw technical text reaching the user; today every existing page interpolates the raw thrown error/message directly into an alert, which is precisely what must change. A single mapping module (rather than ad hoc per-page copy) keeps terminology consistent (per the spec's Terminology & Consistency goal) and gives future backend error additions one obvious place to register a plain-language equivalent, with a safe fallback so an unmapped error can never leak raw text.

**Alternatives considered**: *Per-page inline error copy* — rejected: duplicated effort, higher risk of an unmapped/raw message slipping through on some page, and harder to keep terminology consistent across screens.
