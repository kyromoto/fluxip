import { A } from "@solidjs/router";
import { For, type JSX } from "solid-js";
import { Logo } from "~/components/brand/Logo";
import { Button } from "~/components/ui/button";
import { UserBadge } from "./UserBadge";
import { VersionLabel } from "./VersionLabel";
import { signOut } from "~/services/auth";
import { Breadcrumbs } from "./Breadcrumbs";

const NAV_LINKS = [
  { href: "/ip-clients", label: "Devices" },
  { href: "/credentials", label: "Credentials" },
  { href: "/agents", label: "Agents" },
  { href: "/notifications", label: "Notifications" },
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
        <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
          <div class="flex items-center gap-2.5">
            <A href="/" class="shrink-0" aria-label="FluxIP home">
              <Logo size={40} />
            </A>
            <div class="flex flex-col items-start gap-1 max-sm:hidden">
              <A href="/" class="text-base font-semibold leading-none tracking-tight" tabindex="-1">
                FluxIP
              </A>
              <VersionLabel />
            </div>
          </div>
          {/* Below 768px the links wrap onto their own, horizontally scrollable row (order-last). */}
          <nav
            aria-label="Main"
            class="text-sm font-medium max-md:order-last max-md:-mx-4 max-md:w-[calc(100%+2rem)] max-md:overflow-x-auto max-md:px-4"
          >
            <ul class="flex items-center gap-4 max-md:min-w-max">
              <For each={NAV_LINKS}>
                {(link) => (
                  <li>
                    <A
                      href={link.href}
                      class="touch-target inline-flex items-center text-muted-foreground hover:text-foreground"
                      activeClass="text-foreground"
                    >
                      {link.label}
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </nav>
          <div class="flex items-center gap-3">
            <UserBadge />
            <Button size="sm" variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div class="shrink-0">
        <Breadcrumbs />
      </div>
      {/* Only the content scrolls; header and breadcrumbs stay put. */}
      <main class="min-h-0 flex-1 overflow-y-auto max-md:has-[[data-primary-action]]:pb-24">
        <div class="mx-auto max-w-6xl px-4 py-6">{props.children}</div>
      </main>
    </div>
  );
}
