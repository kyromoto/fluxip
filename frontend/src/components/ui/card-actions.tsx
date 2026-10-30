import type { Component, JSX } from "solid-js"
import { Show } from "solid-js"

import { cn } from "~/lib/cn"

/**
 * Action row for cards and list items (Constitution III.3/III.4): routine
 * actions cluster on the left, destructive ones on the right. Both groups and
 * the wrapped rows are 12px (gap-3) apart, so a destructive button never
 * touches a regular control. Destructive buttons belong in `danger` only.
 */
const CardActions: Component<{ safe?: JSX.Element; danger?: JSX.Element; class?: string }> = (props) => {
  return (
    <div class={cn("flex w-full flex-wrap items-center gap-3", props.class)}>
      <Show when={props.safe}>
        <div data-actions="safe" class="flex flex-wrap items-center gap-3">
          {props.safe}
        </div>
      </Show>
      <Show when={props.danger}>
        <div data-actions="danger" class="ml-auto flex flex-wrap items-center gap-3">
          {props.danger}
        </div>
      </Show>
    </div>
  )
}

export { CardActions }
