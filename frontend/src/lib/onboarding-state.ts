/**
 * Per-tenant, per-browser onboarding progress flag (research.md §2). This is
 * the ONLY piece of onboarding state that persists, and only in
 * `localStorage` — never sent to the backend. Absent ⇒ show the onboarding
 * flow on next authenticated render for that tenant.
 */
function storageKey(tenantId: string): string {
  return `fluxip.onboarding.${tenantId}.completed`;
}

export function hasCompletedOnboarding(tenantId: string): boolean {
  try {
    return localStorage.getItem(storageKey(tenantId)) === "true";
  } catch {
    // Storage unavailable (e.g. private browsing) — don't trap the user
    // behind a wizard that can never be marked done.
    return true;
  }
}

export function markOnboardingComplete(tenantId: string): void {
  try {
    localStorage.setItem(storageKey(tenantId), "true");
  } catch {
    // Nothing to persist if storage is unavailable — the gate will just
    // re-show the wizard next time, which is an acceptable degradation.
  }
}
