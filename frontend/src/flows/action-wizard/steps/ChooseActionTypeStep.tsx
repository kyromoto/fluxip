import { For, type Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { ActionType, ActionWizardData } from "../ActionWizard";

const ACTION_TYPE_OPTIONS: { type: ActionType; title: string; description: string }[] = [
  {
    type: "hetzner_cloud_dns_update",
    title: "Hetzner Cloud DNS Update",
    description: "Keep a Hetzner DNS record pointed at this device's current address.",
  },
  {
    type: "hetzner_cloud_firewall_rule_update",
    title: "Hetzner Cloud Firewall Rule Update",
    description: "Keep a Hetzner Cloud Firewall rule's source address pointed at this device's current address.",
  },
];

export const ChooseActionTypeStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  return (
    <div class="space-y-3">
      <h2 class="text-lg font-semibold">What should happen when the IP changes?</h2>
      <For each={ACTION_TYPE_OPTIONS}>
        {(option) => (
          <button
            type="button"
            class={`w-full rounded-md border p-4 text-left transition-colors ${
              props.data.type === option.type ? "border-primary bg-accent/50" : "border-border hover:bg-accent/30"
            }`}
            onClick={() => props.updateData({ type: option.type })}
          >
            <p class="font-medium">{option.title}</p>
            <p class="text-sm text-muted-foreground">{option.description}</p>
          </button>
        )}
      </For>
    </div>
  );
};
