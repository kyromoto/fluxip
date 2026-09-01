import { Show, type Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { ActionWizardData } from "../ActionWizard";

export const ReviewActionStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  const families = () =>
    [props.data.ipv4 && "IPv4", props.data.ipv6 && "IPv6"].filter(Boolean).join(" and ");

  return (
    <div class="space-y-2">
      <h2 class="text-lg font-semibold">Review</h2>
      <Show
        when={props.data.type === "hetzner_cloud_dns_update"}
        fallback={
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="text-muted-foreground">Firewall ID</dt>
            <dd>{props.data.firewallId}</dd>
            <dt class="text-muted-foreground">Rule</dt>
            <dd>
              {props.data.direction} / {props.data.protocol}
              {props.data.port ? ` / ${props.data.port}` : ""} / {props.data.description}
            </dd>
            <dt class="text-muted-foreground">Keeps updated</dt>
            <dd>{families()}</dd>
          </dl>
        }
      >
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt class="text-muted-foreground">Zone</dt>
          <dd>{props.data.zone}</dd>
          <dt class="text-muted-foreground">Record</dt>
          <dd>{props.data.recordName}</dd>
          <dt class="text-muted-foreground">Keeps updated</dt>
          <dd>{families()}</dd>
        </dl>
      </Show>
      <p class="text-sm text-muted-foreground">
        Once confirmed, this {props.data.type === "hetzner_cloud_dns_update" ? "record" : "rule"} will be kept up to
        date automatically whenever this device's address changes.
      </p>
    </div>
  );
};
