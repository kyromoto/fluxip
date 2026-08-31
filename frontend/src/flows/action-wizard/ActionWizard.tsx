import { untrack } from "solid-js";
import { useWizard, type WizardDefinition } from "~/flows/wizard/useWizard";
import { WizardShell } from "~/flows/wizard/WizardShell";
import { api } from "~/services/api";
import { AddressFamilyStep } from "./steps/AddressFamilyStep";
import { ChooseActionTypeStep } from "./steps/ChooseActionTypeStep";
import { DnsTargetStep } from "./steps/DnsTargetStep";
import { ReviewActionStep } from "./steps/ReviewActionStep";

export interface ActionWizardData {
  type: "hetzner_cloud_dns_update";
  providerCredentialId: string;
  zone: string;
  recordName: string;
  ipv4: boolean;
  ipv6: boolean;
}

export interface ExistingAction {
  actionId: string;
  providerCredentialId: string;
  zone: string;
  recordName: string;
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

/**
 * Guided Action configuration (User Story 3). Only one action type exists
 * today; ChooseActionTypeStep is structured so more can be added later
 * without redesigning this flow (FR-012).
 */
export function ActionWizard(props: ActionWizardProps) {
  // Read once at mount, intentionally non-reactive: a new ActionWizard instance is
  // created per dialog open (Actions.tsx remounts via <Show>), so `existingAction`
  // never changes within one instance's lifetime.
  const existingAction = untrack(() => props.existingAction);
  const initialData: ActionWizardData = existingAction
    ? {
        type: "hetzner_cloud_dns_update",
        providerCredentialId: existingAction.providerCredentialId,
        zone: existingAction.zone,
        recordName: existingAction.recordName,
        ipv4: existingAction.ipv4,
        ipv6: existingAction.ipv6,
      }
    : {
        type: "hetzner_cloud_dns_update",
        providerCredentialId: "",
        zone: "",
        recordName: "",
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
        title: "DNS target",
        component: DnsTargetStep,
        isValid: (d) => d.providerCredentialId.length > 0 && d.zone.trim().length > 0 && d.recordName.trim().length > 0,
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
      const config = { providerCredentialId: data.providerCredentialId, zone: data.zone, recordName: data.recordName };
      if (existingAction) {
        await api.put(`/actions/${existingAction.actionId}`, { addressFamilies, config });
      } else {
        await api.post(`/ip-clients/${props.ipClientId}/actions`, {
          type: "hetzner_cloud_dns_update",
          addressFamilies,
          config,
        });
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
