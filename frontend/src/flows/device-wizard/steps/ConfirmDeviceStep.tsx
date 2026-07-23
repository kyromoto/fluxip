import type { Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { DeviceWizardData } from "../DeviceWizard";

export const ConfirmDeviceStep: Component<WizardStepComponentProps<DeviceWizardData>> = (props) => {
  return (
    <div class="space-y-2">
      <h2 class="text-lg font-semibold">Ready to create "{props.data.label}"?</h2>
      <p class="text-sm text-muted-foreground">
        We'll generate a unique reporting credential for this device — you'll see it once, right
        after creation, so you can configure your router with it.
      </p>
    </div>
  );
};
