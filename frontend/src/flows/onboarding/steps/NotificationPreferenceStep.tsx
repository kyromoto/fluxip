import type { Component } from "solid-js";
import { TextField, TextFieldDescription, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { OnboardingData } from "../OnboardingWizard";

export const NotificationPreferenceStep: Component<WizardStepComponentProps<OnboardingData>> = (props) => {
  return (
    <div class="space-y-2">
      <h2 class="text-lg font-semibold">Stay informed (optional)</h2>
      <TextField
        value={props.data.notificationAddresses}
        onChange={(value) => props.updateData({ notificationAddresses: value })}
      >
        <TextFieldLabel>Email address(es)</TextFieldLabel>
        <TextFieldInput type="email" placeholder="you@example.com" />
        <TextFieldDescription>
          We'll email you when one of your devices' updates succeeds or fails. Separate multiple
          addresses with commas, or leave this blank and set it up later.
        </TextFieldDescription>
      </TextField>
    </div>
  );
};
