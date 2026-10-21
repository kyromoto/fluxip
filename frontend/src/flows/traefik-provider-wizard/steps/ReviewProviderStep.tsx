import type { Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { TraefikProviderWizardData } from "../TraefikProviderWizard";

export const ReviewProviderStep: Component<WizardStepComponentProps<TraefikProviderWizardData>> = (props) => (
  <div class="space-y-2">
    <h2 class="text-lg font-semibold">Review</h2>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt class="text-muted-foreground">Name</dt>
      <dd>{props.data.name.trim()}</dd>
      <dt class="text-muted-foreground">Connection</dt>
      <dd>Agent connects to FluxIP</dd>
    </dl>
    <p class="text-sm text-muted-foreground">
      After you confirm, FluxIP shows the agent address, a token and a start command. The token is shown only once.
    </p>
  </div>
);
