import { createResource, createSignal, Show, type JSX } from "solid-js";
import { hasCompletedOnboarding, markOnboardingComplete } from "~/lib/onboarding-state";
import { api } from "~/services/api";
import { OnboardingWizard } from "./OnboardingWizard";

async function fetchAccountId(): Promise<string> {
  const account = await api.get<{ accountId: string }>("/account");
  return account.accountId;
}

/**
 * Wraps the authenticated app: shows the native onboarding flow instead of
 * routed content when the current account hasn't completed it yet (FR-018),
 * otherwise renders children unchanged.
 */
export function OnboardingGate(props: { children?: JSX.Element }) {
  const [accountId] = createResource(fetchAccountId);
  const [dismissedThisSession, setDismissedThisSession] = createSignal(false);

  function shouldShowOnboarding(): boolean {
    const id = accountId();
    if (!id || dismissedThisSession()) return false;
    return !hasCompletedOnboarding(id);
  }

  return (
    <Show when={!accountId.loading} fallback={null}>
      <Show when={shouldShowOnboarding()} fallback={props.children}>
        <OnboardingWizard
          onComplete={() => {
            markOnboardingComplete(accountId() as string);
            setDismissedThisSession(true);
          }}
          onCancel={() => setDismissedThisSession(true)}
        />
      </Show>
    </Show>
  );
}
