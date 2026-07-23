import { A, useLocation } from "@solidjs/router";
import { For, onMount, Show, type JSX } from "solid-js";
import { Button } from "~/components/ui/button";
import { OnboardingGate } from "~/flows/onboarding/OnboardingGate";
import { isAuthenticated, refreshAuthState, signIn, signOut } from "~/services/auth";

const NAV_LINKS = [
  { href: "/ip-clients", label: "Devices" },
  { href: "/notifications", label: "Notifications" },
  { href: "/account", label: "Account" },
];

/**
 * Responsive nav + frame replacing the ad hoc Layout() in App.tsx (FR-001/002).
 * Every screen renders inside this shell; dark/light appearance comes from
 * app.css's `prefers-color-scheme` variables alone — no theme logic here.
 */
export function AppShell(props: { children?: JSX.Element }) {
  const location = useLocation();

  onMount(() => {
    void refreshAuthState();
  });

  return (
    <div class="min-h-screen bg-background text-foreground">
      <header class="border-b">
        <div class="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav class="flex flex-wrap items-center gap-4 text-sm font-medium">
            <For each={NAV_LINKS}>
              {(link) => (
                <A href={link.href} class="text-muted-foreground hover:text-foreground" activeClass="text-foreground">
                  {link.label}
                </A>
              )}
            </For>
          </nav>
          <Show
            when={isAuthenticated()}
            fallback={
              <Button size="sm" onClick={() => void signIn()}>
                Sign in
              </Button>
            }
          >
            <Button size="sm" variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </Show>
        </div>
      </header>
      <main class="mx-auto max-w-4xl px-4 py-6">
        <Show
          when={isAuthenticated() || location.pathname === "/callback"}
          fallback={<p class="text-muted-foreground">Please sign in to continue.</p>}
        >
          <Show when={location.pathname !== "/callback"} fallback={props.children}>
            <OnboardingGate>{props.children}</OnboardingGate>
          </Show>
        </Show>
      </main>
    </div>
  );
}
