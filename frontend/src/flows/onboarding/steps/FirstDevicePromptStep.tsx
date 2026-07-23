import type { Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { OnboardingData } from "../OnboardingWizard";

export const FirstDevicePromptStep: Component<WizardStepComponentProps<OnboardingData>> = (props) => {
  return (
    <div class="space-y-3">
      <h2 class="text-lg font-semibold">Ready to automate your first device?</h2>
      <p class="text-sm text-muted-foreground">
        A device (like your home router) reports when its address changes, and FluxIP keeps a DNS
        record pointed at it automatically. You can add one now, or do it later from your device
        overview.
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          class={cn(!props.data.wantsFirstDevice && "opacity-60")}
          onClick={() => props.updateData({ wantsFirstDevice: true })}
        >
          Add my first device now
        </Button>
        <Button
          type="button"
          variant="outline"
          class={cn(props.data.wantsFirstDevice && "opacity-60")}
          onClick={() => props.updateData({ wantsFirstDevice: false })}
        >
          I'll do this later
        </Button>
      </div>
    </div>
  );
};
