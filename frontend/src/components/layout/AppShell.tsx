import { A } from "@solidjs/router";
import { For, type JSX } from "solid-js";
import { Button } from "~/components/ui/button";
import { signOut } from "~/services/auth";

const NAV_LINKS = [
  { href: "/ip-clients", label: "Devices" },
  { href: "/credentials", label: "Credentials" },
  { href: "/notifications", label: "Notifications" },
  { href: "/account", label: "Account" },
];

/**
 * Responsive nav + frame replacing the ad hoc Layout() in App.tsx (FR-001/002).
 * Only ever rendered inside ProtectedLayout — by the time this mounts, the
 * user is already known to be authenticated, so there's no sign-in/loading
 * branching here. Dark/light appearance comes from app.css's
 * `prefers-color-scheme` variables alone — no theme logic here.
 */
export function AppShell(props: { children?: JSX.Element }) {
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
          <Button size="sm" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main class="mx-auto max-w-4xl px-4 py-6">{props.children}</main>
    </div>
  );
}
