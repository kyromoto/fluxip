import { useParams } from "@solidjs/router";
import type { JSX } from "solid-js";
import { NavTabs } from "~/components/ui/nav-tabs";

/**
 * Shared frame for a device's sections: the tab bar sits directly under the
 * breadcrumbs, the active section renders below it (Constitution III.2).
 */
export function DeviceLayout(props: { children?: JSX.Element }) {
  const params = useParams<{ ipClientId: string }>();
  const base = () => `/ip-clients/${params.ipClientId}`;

  return (
    <div class="space-y-6">
      <NavTabs
        label="Device sections"
        items={[
          { href: `${base()}/actions`, label: "Actions" },
          { href: `${base()}/history`, label: "History" },
          { href: `${base()}/settings`, label: "Settings" },
        ]}
      />
      {props.children}
    </div>
  );
}
