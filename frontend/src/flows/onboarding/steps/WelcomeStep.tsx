import type { Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { OnboardingData } from "../OnboardingWizard";

export const WelcomeStep: Component<WizardStepComponentProps<OnboardingData>> = () => {
  return (
    <div class="space-y-2">
      <h2 class="text-lg font-semibold">Welcome to FluxIP</h2>
      <p class="text-sm text-muted-foreground">
        Let's get you set up — this only takes a minute. You can change any of these choices later
        in Account or Notification Settings.
      </p>
    </div>
  );
};
