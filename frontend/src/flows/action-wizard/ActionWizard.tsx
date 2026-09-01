import { Show, untrack, type Component } from "solid-js";
import { useWizard, type WizardDefinition, type WizardStepComponentProps } from "~/flows/wizard/useWizard";
import { WizardShell } from "~/flows/wizard/WizardShell";
import { api } from "~/services/api";
import { AddressFamilyStep } from "./steps/AddressFamilyStep";
import { ChooseActionTypeStep } from "./steps/ChooseActionTypeStep";
import { DnsTargetStep } from "./steps/DnsTargetStep";
import { FirewallRuleTargetStep } from "./steps/FirewallRuleTargetStep";
import { ReviewActionStep } from "./steps/ReviewActionStep";

export type ActionType = "hetzner_cloud_dns_update" | "hetzner_cloud_firewall_rule_update";
export type FirewallDirection = "in" | "out";
export type FirewallProtocol = "tcp" | "udp" | "icmp" | "esp" | "ah" | "gre";

export interface ActionWizardData {
  type: ActionType;
  providerCredentialId: string;
  // hetzner_cloud_dns_update fields
  zone: string;
  recordName: string;
  // hetzner_cloud_firewall_rule_update fields
  firewallId: string;
  direction: FirewallDirection;
  protocol: FirewallProtocol;
  port: string;
  description: string;
  // shared (FR-004)
  ipv4: boolean;
  ipv6: boolean;
}

export interface ExistingAction {
  actionId: string;
  type: ActionType;
  providerCredentialId: string;
  zone: string;
  recordName: string;
  firewallId: string;
  direction: FirewallDirection;
  protocol: FirewallProtocol;
  port: string;
  description: string;
  ipv4: boolean;
  ipv6: boolean;
}

interface ActionWizardProps {
  ipClientId: string;
  /** Present when reconfiguring an existing Action rather than creating a new one. */
  existingAction?: ExistingAction;
  onDone: () => void;
  /** Always available — abandoning creates/changes nothing (FR-010). */
  onCancel: () => void;
}

/** Renders the DNS or Firewall target step based on the chosen Action type (FR-015 — same flow, no redesign). */
const TargetStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => (
  <Show when={props.data.type === "hetzner_cloud_dns_update"} fallback={<FirewallRuleTargetStep {...props} />}>
    <DnsTargetStep {...props} />
  </Show>
);

/**
 * Guided Action configuration (User Story 3 of 003-end-user-ui-redesign). Two Action types exist
 * (007-hetzner-firewall-action added the second); ChooseActionTypeStep lets the user pick between
 * them without redesigning this flow (FR-012 of 001, FR-015 of 007).
 */
export function ActionWizard(props: ActionWizardProps) {
  // Read once at mount, intentionally non-reactive: a new ActionWizard instance is
  // created per dialog open (Actions.tsx remounts via <Show>), so `existingAction`
  // never changes within one instance's lifetime.
  const existingAction = untrack(() => props.existingAction);
  const initialData: ActionWizardData = existingAction
    ? { ...existingAction }
    : {
        type: "hetzner_cloud_dns_update",
        providerCredentialId: "",
        zone: "",
        recordName: "",
        firewallId: "",
        direction: "in",
        protocol: "tcp",
        port: "",
        description: "",
        ipv4: true,
        ipv6: false,
      };

  const definition: WizardDefinition<ActionWizardData> = {
    id: "action-wizard",
    initialData,
    steps: [
      { id: "type", title: "Action type", component: ChooseActionTypeStep, isValid: () => true },
      {
        id: "target",
        title: "Target",
        component: TargetStep,
        isValid: (d) =>
          d.type === "hetzner_cloud_dns_update"
            ? d.providerCredentialId.length > 0 && d.zone.trim().length > 0 && d.recordName.trim().length > 0
            : d.providerCredentialId.length > 0 &&
              d.firewallId.trim().length > 0 &&
              d.direction.length > 0 &&
              d.protocol.length > 0 &&
              d.description.trim().length > 0,
      },
      {
        id: "address-family",
        title: "Address family",
        component: AddressFamilyStep,
        isValid: (d) => d.ipv4 || d.ipv6,
      },
      { id: "review", title: "Review", component: ReviewActionStep, isValid: () => true },
    ],
    onComplete: async (data) => {
      const addressFamilies = [data.ipv4 && "ipv4", data.ipv6 && "ipv6"].filter(Boolean);
      const config =
        data.type === "hetzner_cloud_dns_update"
          ? { providerCredentialId: data.providerCredentialId, zone: data.zone, recordName: data.recordName }
          : {
              providerCredentialId: data.providerCredentialId,
              firewallId: Number(data.firewallId),
              direction: data.direction,
              protocol: data.protocol,
              port: data.port.trim() ? data.port : undefined,
              description: data.description,
            };
      if (existingAction) {
        await api.put(`/actions/${existingAction.actionId}`, { addressFamilies, config });
      } else {
        await api.post(`/ip-clients/${props.ipClientId}/actions`, { type: data.type, addressFamilies, config });
      }
      props.onDone();
    },
  };

  const wizard = useWizard(definition);

  return (
    <WizardShell
      wizard={wizard}
      onCancel={() => props.onCancel()}
      confirmLabel={existingAction ? "Save changes" : "Attach action"}
    />
  );
}
