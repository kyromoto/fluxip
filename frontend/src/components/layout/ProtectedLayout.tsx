import { useNavigate } from "@solidjs/router";
import { createEffect, onMount, Show, type JSX } from "solid-js";
import { OnboardingGate } from "~/flows/onboarding/OnboardingGate";
import { authStatus, refreshAuthState } from "~/services/auth";
import { AppShell } from "./AppShell";

/**
 * Wraps every route that requires an authenticated user. While the initial
 * auth check is in flight, renders only a loading state — never the menu,
 * never a redirect. Once resolved: authenticated renders the menu (AppShell)
 * around the routed page; unauthenticated redirects to /login without the
 * menu ever having been visible.
 */
export function ProtectedLayout(props: { children?: JSX.Element }) {
  const navigate = useNavigate();

  onMount(() => {
    void refreshAuthState();
  });

  createEffect(() => {
    if (authStatus() === "unauthenticated") {
      navigate("/login", { replace: true });
    }
  });

  return (
    <Show
      when={authStatus() === "authenticated"}
      fallback={
        <Show when={authStatus() === "loading"}>
          <div class="flex min-h-screen items-center justify-center">
            <div class="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        </Show>
      }
    >
      <AppShell>
        <OnboardingGate>{props.children}</OnboardingGate>
      </AppShell>
    </Show>
  );
}
