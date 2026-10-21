import type { Component } from "solid-js";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import type { TraefikProviderWizardData } from "../TraefikProviderWizard";

export const NameStep: Component<WizardStepComponentProps<TraefikProviderWizardData>> = (props) => (
  <div class="space-y-4">
    <h2 class="text-lg font-semibold">Where does this Traefik run?</h2>
    <p class="text-sm text-muted-foreground">
      Each Traefik provider stands for one agent next to one Traefik, for example one location. Give it a name you will
      recognise.
    </p>
    <TextField value={props.data.name} onChange={(value) => props.updateData({ name: value })}>
      <TextFieldLabel>Name</TextFieldLabel>
      <TextFieldInput placeholder="e.g. Office Berlin" maxLength={100} />
    </TextField>
  </div>
);
