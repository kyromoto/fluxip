import { A } from "@solidjs/router";
import { For, type JSX } from "solid-js";
import { Logo } from "~/components/brand/Logo";
import { Button } from "~/components/ui/button";
import { VersionLabel } from "./VersionLabel";
import { signOut } from "~/services/auth";
import { Breadcrumbs } from "./Breadcrumbs";

const NAV_LINKS = [
  { href: "/ip-clients", label: "Devices" },
  { href: "/credentials", label: "Credentials" },
  { href: "/agents", label: "Agents" },
  { href: "/notifications", label: "Notifications" },
  { href: "/account", label: "Account" },
];

/**
 * Responsive nav + frame replacing the ad hoc Layout() in App.tsx (FR-001/002).
 * Only ever rendered inside ProtectedLayout — by the time this mounts, the
 * user is already known to be authenticated, so there's no sign-in/loading
 * branching here. Dark/light appearance comes from app.css's
 * `prefers-color-scheme` variables alone — no theme logic here.
 *
 * The frame fills the viewport and only <main> scrolls, so header and breadcrumbs stay visible on long pages.
 */
export function AppShell(props: { children?: JSX.Element }) {
  return (
    <div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header class="shrink-0 border-b">
        <div class="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div class="flex items-center gap-2.5">
            <A href="/" class="shrink-0" aria-label="FluxIP home">
              <Logo size={40} />
            </A>
            <div class="flex flex-col items-start gap-1">
              <A href="/" class="text-base font-semibold leading-none tracking-tight" tabindex="-1">
                FluxIP
              </A>
              <VersionLabel />
            </div>
          </div>
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
      <div class="shrink-0">
        <Breadcrumbs />
      </div>
      {/* Only the content scrolls; header and breadcrumbs stay put. */}
      <main class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto max-w-4xl px-4 py-6">{props.children}</div>
      </main>
    </div>
  );
}
