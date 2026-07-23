import type { Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { ActionWizardData } from "../ActionWizard";

/**
 * Only one action type exists today (FR-012): structured so a future type
 * can be added here as another option without redesigning the flow.
 */
export const ChooseActionTypeStep: Component<WizardStepComponentProps<ActionWizardData>> = () => {
  return (
    <div class="space-y-3">
      <h2 class="text-lg font-semibold">What should happen when the IP changes?</h2>
      <div class="rounded-md border border-primary bg-accent/50 p-4">
        <p class="font-medium">Update a DNS record</p>
        <p class="text-sm text-muted-foreground">
          Keep a Hetzner DNS record pointed at this device's current address. More action types
          will appear here in the future.
        </p>
      </div>
    </div>
  );
};
