import { createSignal, Show } from "solid-js";
import { useWizard, type WizardDefinition } from "~/flows/wizard/useWizard";
import { WizardShell } from "~/flows/wizard/WizardShell";
import { api } from "~/services/api";
import { ConfirmDeviceStep } from "./steps/ConfirmDeviceStep";
import { NameDeviceStep } from "./steps/NameDeviceStep";
import { ReviewCredentialStep } from "./steps/ReviewCredentialStep";

export interface DeviceWizardData {
  label: string;
}

interface RegisterResponse {
  ipClientId: string;
  label?: string;
  reportingCredential: { username: string; password: string };
}

interface DeviceWizardProps {
  /** Called once the user dismisses the post-creation credential screen. */
  onDone: () => void;
  /** Always available — abandoning creates nothing (FR-010). */
  onCancel: () => void;
}

/**
 * Guided Trigger Device creation (User Story 2). The reporting credential
 * only exists after the real `POST /ip-clients` call succeeds, so it's shown
 * as a post-completion screen rather than a wizard step — see
 * ReviewCredentialStep.tsx.
 */
export function DeviceWizard(props: DeviceWizardProps) {
  const [created, setCreated] = createSignal<RegisterResponse | null>(null);

  const definition: WizardDefinition<DeviceWizardData> = {
    id: "device-wizard",
    initialData: { label: "" },
    steps: [
      { id: "name", title: "Name", component: NameDeviceStep, isValid: (d) => d.label.trim().length > 0 },
      { id: "confirm", title: "Confirm", component: ConfirmDeviceStep, isValid: () => true },
    ],
    onComplete: async (data) => {
      const result = await api.post<RegisterResponse>("/ip-clients", { label: data.label.trim() });
      setCreated(result);
    },
  };

  const wizard = useWizard(definition);

  return (
    <Show
      when={created()}
      fallback={<WizardShell wizard={wizard} onCancel={() => props.onCancel()} confirmLabel="Create device" />}
    >
      {(result) => (
        <ReviewCredentialStep
          username={result().reportingCredential.username}
          password={result().reportingCredential.password}
          onDone={() => props.onDone()}
        />
      )}
    </Show>
  );
}
