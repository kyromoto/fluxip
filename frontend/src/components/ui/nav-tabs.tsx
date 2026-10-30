import { A } from "@solidjs/router"
import type { Component } from "solid-js"
import { For } from "solid-js"

import { cn } from "~/lib/cn"

interface NavTab {
  href: string
  label: string
}

/**
 * Link-based tab bar for sections that have their own URL (e.g. a device's
 * Actions / History / Settings). The router's <A> sets aria-current="page"
 * on the active link; the underline keeps the active state visible without
 * relying on colour alone (Constitution III.2).
 */
const NavTabs: Component<{ items: NavTab[]; label: string; class?: string }> = (props) => {
  return (
    <nav aria-label={props.label} class={cn("overflow-x-auto border-b", props.class)}>
      <ul class="flex min-w-max gap-1">
        <For each={props.items}>
          {(item) => (
            <li>
              <A
                href={item.href}
                end
                class="touch-target -mb-px inline-flex items-center border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                activeClass="border-primary text-foreground"
              >
                {item.label}
              </A>
            </li>
          )}
        </For>
      </ul>
    </nav>
  )
}

export { NavTabs }
export type { NavTab }
