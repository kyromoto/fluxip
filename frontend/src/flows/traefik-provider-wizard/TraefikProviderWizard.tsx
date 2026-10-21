import { useWizard, type WizardDefinition } from "~/flows/wizard/useWizard";
import { WizardShell } from "~/flows/wizard/WizardShell";
import type { CreatedProvider } from "~/lib/traefik-providers";
import { api } from "~/services/api";
import { ConnectionModeStep } from "./steps/ConnectionModeStep";
import { NameStep } from "./steps/NameStep";
import { ReviewProviderStep } from "./steps/ReviewProviderStep";

export interface TraefikProviderWizardData {
  name: string;
  connectionMode: "agent_initiated" | "server_initiated";
}

interface TraefikProviderWizardProps {
  onCreated: (created: CreatedProvider) => void;
  onCancel: () => void;
}

/** Guided creation of a Traefik provider (FR-005); the network call happens only on the final confirmation. */
export function TraefikProviderWizard(props: TraefikProviderWizardProps) {
  const definition: WizardDefinition<TraefikProviderWizardData> = {
    id: "traefik-provider-wizard",
    initialData: { name: "", connectionMode: "agent_initiated" },
    steps: [
      { id: "name", title: "Name", component: NameStep, isValid: (d) => d.name.trim().length > 0 },
      {
        id: "connection",
        title: "Connection",
        component: ConnectionModeStep,
        isValid: (d) => d.connectionMode === "agent_initiated",
      },
      { id: "review", title: "Review", component: ReviewProviderStep, isValid: () => true },
    ],
    onComplete: async (data) => {
      const created = await api.post<CreatedProvider>("/agents", {
        name: data.name.trim(),
        connectionMode: data.connectionMode,
      });
      props.onCreated(created);
    },
  };

  const wizard = useWizard(definition);
  return <WizardShell wizard={wizard} onCancel={() => props.onCancel()} confirmLabel="Create agent" />;
}
