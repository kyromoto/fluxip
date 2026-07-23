import type { Component } from "solid-js";
import { TextField, TextFieldDescription, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { DeviceWizardData } from "../DeviceWizard";

export const NameDeviceStep: Component<WizardStepComponentProps<DeviceWizardData>> = (props) => {
  return (
    <div class="space-y-2">
      <h2 class="text-lg font-semibold">Name your device</h2>
      <TextField value={props.data.label} onChange={(value) => props.updateData({ label: value })}>
        <TextFieldLabel>Label</TextFieldLabel>
        <TextFieldInput placeholder="e.g. Home FritzBox" />
        <TextFieldDescription>
          Pick something that helps you recognize it later — like the location it's at.
        </TextFieldDescription>
      </TextField>
    </div>
  );
};
