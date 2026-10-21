import { For, type Component } from "solid-js";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { TraefikProviderWizardData } from "../TraefikProviderWizard";

const MODES = [
  {
    value: "agent_initiated" as const,
    title: "Agent connects to FluxIP",
    description: "The agent dials out to FluxIP. Nothing needs to be opened on the Traefik side.",
    available: true,
  },
  {
    value: "server_initiated" as const,
    title: "FluxIP connects to the agent",
    description: "FluxIP dials the agent. Not available yet.",
    available: false,
  },
];

/** Variant B is shown but cannot be chosen (FR-031, US8-1). */
export const ConnectionModeStep: Component<WizardStepComponentProps<TraefikProviderWizardData>> = (props) => (
  <div class="space-y-3">
    <h2 class="text-lg font-semibold">How does the agent reach FluxIP?</h2>
    <For each={MODES}>
      {(mode) => (
        <button
          type="button"
          disabled={!mode.available}
          aria-disabled={!mode.available}
          class={`w-full rounded-md border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            props.data.connectionMode === mode.value ? "border-primary bg-accent/50" : "border-border hover:bg-accent/30"
          }`}
          onClick={() => mode.available && props.updateData({ connectionMode: mode.value })}
        >
          <p class="font-medium">
            {mode.title}
            {!mode.available && <span class="ml-2 text-xs font-normal text-muted-foreground">Not yet available</span>}
          </p>
          <p class="text-sm text-muted-foreground">{mode.description}</p>
        </button>
      )}
    </For>
  </div>
);
