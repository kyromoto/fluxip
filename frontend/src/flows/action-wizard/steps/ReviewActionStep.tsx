import type { Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { ActionWizardData } from "../ActionWizard";

export const ReviewActionStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  const families = () =>
    [props.data.ipv4 && "IPv4", props.data.ipv6 && "IPv6"].filter(Boolean).join(" and ");

  return (
    <div class="space-y-2">
      <h2 class="text-lg font-semibold">Review</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="text-muted-foreground">Zone</dt>
        <dd>{props.data.zone}</dd>
        <dt class="text-muted-foreground">Record</dt>
        <dd>{props.data.recordName}</dd>
        <dt class="text-muted-foreground">Keeps updated</dt>
        <dd>{families()}</dd>
      </dl>
      <p class="text-sm text-muted-foreground">
        Once confirmed, this record will be kept up to date automatically whenever this device's
        address changes.
      </p>
    </div>
  );
};
