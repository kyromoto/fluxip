import { Show, useContext, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { DeviceActionSlot } from "~/components/layout/DeviceLayout";

/**
 * Page heading for assistive technology plus the slot for the page's primary
 * action. The visible title is intentionally absent: the breadcrumb (and, on
 * device pages, the tab bar) already names the page (Constitution III.2).
 * Inside a device the actions move into the tab bar's right-hand end.
 */
export function PageHeader(props: { title: string; children?: JSX.Element }) {
  const deviceSlot = useContext(DeviceActionSlot);

  return (
    <>
      <h1 class="sr-only">{props.title}</h1>
      <Show when={props.children}>
        <Show
          when={deviceSlot}
          fallback={
            <div class="flex flex-wrap items-center justify-end gap-3 max-md:has-[[data-primary-action]]:contents">{props.children}</div>
          }
        >
          <Show when={deviceSlot!()}>{(mount) => <Portal mount={mount()}>{props.children}</Portal>}</Show>
        </Show>
      </Show>
    </>
  );
}
