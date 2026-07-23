# Quickstart: Validating the End-User UI Redesign

## Prerequisites

- Repo already set up per the root `README.md` (`pnpm install`, `docker-compose up` for Postgres/Redis/Logto, `.env` populated from `.env.example`).
- `frontend/.env` (or equivalent) with `VITE_LOGTO_ENDPOINT` / `VITE_LOGTO_APP_ID` / `VITE_LOGTO_API_RESOURCE` set, matching a running Logto instance (`docker-compose.yml`'s `logto` service).
- This setup is already done in the repo (Tailwind config, `ui.config.json`, `frontend/src/components/ui/*`, `playwright.config.ts` all committed) — the steps below are for reference/reproducing from scratch (see `research.md` §3 for rationale):

  ```bash
  cd frontend
  pnpm add @kobalte/core class-variance-authority clsx tailwind-merge   # runtime deps
  pnpm add -D tailwindcss@3 postcss autoprefixer @types/node            # dev-only
  npx tailwindcss init -p
  ```

  `solidui-cli`'s own `init`/`add` prompts are not scriptable non-interactively, and its config file is actually named `ui.config.json` (not `components.json`, despite what its own docs imply) — see `frontend/ui.config.json` for the working config. Its `add` command also has an upstream bug where the auto dependency-install step always fails under pnpm (`pnpm add '' '@kobalte/core'`, an empty string argument); the component *file* is still written to disk before that crash, so run `add` once per component and ignore the trailing error:

  ```bash
  npx solidui-cli@latest add button card dialog text-field select checkbox progress alert label table separator --overwrite
  ```

  (There is no "input" or "form" component in the actual registry — `text-field` is the real name for text inputs, and forms are plain `<form>` + these field components.)

  ```bash
  pnpm add -D @solidjs/testing-library @playwright/test @axe-core/playwright jsdom
  npx playwright install chromium   # `--with-deps` needs sudo; add it if your environment allows
  ```

## Run the app

```bash
pnpm dev:frontend   # http://localhost:5173, proxies /api to the backend per vite.config.ts
pnpm dev:backend    # separate terminal — required for any real data (Trigger Devices, Actions, …)
```

## Manual validation scenarios (map to spec.md User Stories)

1. **Guided Account Onboarding (User Story 1)** — In a private/incognito window, sign up via the "Sign in" button (redirects to Logto's hosted sign-up). After returning to `/callback` → `/`, confirm the native onboarding flow appears automatically with a visible step indicator, survives going back a step without losing later answers, and — on completion — lands in the main app with the Trigger Device overview ready to use. Reload the app in the same window afterward and confirm onboarding does **not** reappear (per the `localStorage` flag, research.md §2).
2. **Guided Trigger Device Setup (User Story 2)** — From an empty Trigger Device overview, use the `EmptyState` call-to-action (or the normal "Add device" entry point) to launch the Device Wizard; step through it on both a desktop-width and a 360px-width viewport (browser dev tools device toolbar); confirm the device appears in the overview only after the final step, and confirm closing the wizard mid-flow leaves no partial device behind (`GET /ip-clients` afterward should not list it).
3. **Guided Action Configuration (User Story 3)** — With an existing Trigger Device, launch the Action Wizard, choose the DNS-update type, select a target, and confirm the resulting Action appears in that device's action list only after the final step.
4. **Consistent/Responsive/Plain-language experience (User Story 4)** — Toggle the OS-level color scheme (e.g. macOS System Settings → Appearance, or `prefers-color-scheme` emulation in browser dev tools) while the app is open on a simple screen (e.g. `NotificationSettings`) and confirm the appearance updates live with no reload and no toggle UI present anywhere. Force a failing request (e.g. submit a too-short password on `Account`) and confirm the shown message matches `contracts/error-message-catalog.md`, never the raw thrown value.

## Automated checks

```bash
pnpm --filter fluxip-frontend test                                    # Vitest: useWizard step logic, errors.ts mapping
npx playwright test responsive.spec.ts accessibility.spec.ts          # no auth needed — real checks against the unauthenticated fallback screen
npx playwright test                                                    # full suite — onboarding/device-wizard/action-wizard specs need playwright/.auth/user.json (tests/e2e/README.md)
```

Expected outcomes: zero axe violations at AA level in both color schemes (SC-008); no horizontal-overflow assertion failures at 360px or desktop widths (SC-004); all three wizard smoke paths complete and result in the expected resource existing exactly once. The Vitest suite and the no-auth-required Playwright specs were run for real as part of this feature's implementation (11/11 and 32/32 passing); the auth-gated specs additionally had every authenticated screen and wizard manually verified via a temporary, fully-reverted mocked-auth technique (see tasks.md's Phase 6 checkpoint note) rather than run through this exact command, since that requires a real Logto session this environment couldn't safely produce.

## What this quickstart does not cover

Timed usability criteria (SC-001 "under 3 minutes", SC-002 "under 5 minutes", SC-006 "90% describe it as modern/easy") require moderated or survey-based usability testing with real participants — not something a `pnpm`/`playwright` command can assert. Track these separately during a usability pass before considering the feature fully validated against its Success Criteria.
