import type { Component } from "solid-js";
import { Checkbox } from "~/components/ui/checkbox";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { ActionWizardData } from "../ActionWizard";

/** Copy is generic across Action types (FR-004) — "A"/"AAAA record" only makes sense for the DNS Action. */
export const AddressFamilyStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  const isDns = () => props.data.type === "hetzner_cloud_dns_update";

  return (
    <div class="space-y-3">
      <h2 class="text-lg font-semibold">Which address(es) should this keep updated?</h2>
      <label class="flex items-center gap-2 text-sm">
        <Checkbox checked={props.data.ipv4} onChange={(checked) => props.updateData({ ipv4: checked })} />
        IPv4{isDns() ? " (A record)" : ""}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <Checkbox checked={props.data.ipv6} onChange={(checked) => props.updateData({ ipv6: checked })} />
        IPv6{isDns() ? " (AAAA record)" : ""}
      </label>
    </div>
  );
};
