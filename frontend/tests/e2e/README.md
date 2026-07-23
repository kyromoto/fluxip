# E2E tests (Playwright)

Registration and login are entirely Logto-hosted (research.md §1) — FluxIP's own frontend never
renders a credential form. That means authenticated e2e scenarios need a real, already-completed
Logto sign-in, which these tests do **not** attempt to automate: scripting a sign-up against a
real Logto tenant is not something a test run should do.

Instead, these tests follow [Playwright's documented pattern for OIDC/SSO-gated
apps](https://playwright.dev/docs/auth): a **one-time, manual** setup step produces a reusable
storage state file, and every project then starts already signed in.

## One-time setup

1. Point `frontend/.env`'s `VITE_LOGTO_*` at whichever Logto tenant you want to test against (the
   local `docker-compose` instance, or a dedicated test tenant — never a production tenant).
2. `pnpm dev:frontend` (and `pnpm dev:backend` if the scenario needs real data).
3. Sign in once through the browser as you normally would.
4. Export that browser's storage state:
   ```bash
   mkdir -p playwright/.auth
   npx playwright open http://localhost:5173 --save-storage=playwright/.auth/user.json
   ```
   (or use `page.context().storageState({ path: ... })` from a small one-off script after signing
   in programmatically, if your Logto tenant's test connector supports it).

`playwright.config.ts` automatically picks up `playwright/.auth/user.json` if present (see
`AUTH_STATE_PATH`) and is gitignored — it is never committed.

## Without a storage state

Tests that don't require authentication (responsive layout, accessibility audits of the
unauthenticated screen, the "please sign in" fallback) run fine with no setup. Tests that assume
an authenticated session will fail with the same "Please sign in to continue" fallback shown to a
real signed-out user if no `playwright/.auth/user.json` is present — that's expected, not a bug in
the test.
