/**
 * Per-account, per-browser onboarding progress flag (research.md §2). This is
 * the ONLY piece of onboarding state that persists, and only in
 * `localStorage` — never sent to the backend. Absent ⇒ show the onboarding
 * flow on next authenticated render for that account.
 */
function storageKey(accountId: string): string {
  return `fluxip.onboarding.${accountId}.completed`;
}

export function hasCompletedOnboarding(accountId: string): boolean {
  try {
    return localStorage.getItem(storageKey(accountId)) === "true";
  } catch {
    // Storage unavailable (e.g. private browsing) — don't trap the user
    // behind a wizard that can never be marked done.
    return true;
  }
}

export function markOnboardingComplete(accountId: string): void {
  try {
    localStorage.setItem(storageKey(accountId), "true");
  } catch {
    // Nothing to persist if storage is unavailable — the gate will just
    // re-show the wizard next time, which is an acceptable degradation.
  }
}
