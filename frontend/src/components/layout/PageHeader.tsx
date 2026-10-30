import { Show, type JSX } from "solid-js";

/**
 * Page heading for assistive technology plus the slot for the page's primary
 * action. The visible title is intentionally absent: the breadcrumb (and, on
 * device pages, the tab bar) already names the page (Constitution III.2).
 */
export function PageHeader(props: { title: string; children?: JSX.Element }) {
  return (
    <>
      <h1 class="sr-only">{props.title}</h1>
      <Show when={props.children}>
        <div class="flex flex-wrap items-center justify-end gap-3 max-md:has-[[data-primary-action]]:contents">{props.children}</div>
      </Show>
    </>
  );
}
