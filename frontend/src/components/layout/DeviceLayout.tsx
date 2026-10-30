import { useParams } from "@solidjs/router";
import { createContext, createSignal, type JSX } from "solid-js";
import { NavTabs } from "~/components/ui/nav-tabs";

/** The right-hand end of the tab bar, where a device page's primary action lands. */
export const DeviceActionSlot = createContext<() => HTMLElement | undefined>();

/**
 * Shared frame for a device's sections: the tab bar sits directly under the
 * breadcrumbs with the page's primary action on its right, the active section
 * renders below it (Constitution III.2).
 */
export function DeviceLayout(props: { children?: JSX.Element }) {
  const params = useParams<{ ipClientId: string }>();
  const base = () => `/ip-clients/${params.ipClientId}`;
  const [slot, setSlot] = createSignal<HTMLElement>();

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-3 border-b">
        <NavTabs
          label="Device sections"
          items={[
            { href: `${base()}/actions`, label: "Actions" },
            { href: `${base()}/history`, label: "History" },
            { href: `${base()}/settings`, label: "Settings" },
          ]}
        />
        <div ref={setSlot} class="flex shrink-0 items-center gap-3 py-1" />
      </div>
      <DeviceActionSlot.Provider value={slot}>{props.children}</DeviceActionSlot.Provider>
    </div>
  );
}
