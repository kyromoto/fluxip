import { createResource, type Component } from "solid-js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import { api } from "~/services/api";
import type { ActionWizardData } from "../ActionWizard";

interface ProviderCredentialSummary {
  credentialId: string;
  provider: string;
  label: string;
}

async function fetchCredentials(): Promise<ProviderCredentialSummary[]> {
  const res = await api.get<{ items: ProviderCredentialSummary[] }>("/provider-credentials");
  return res.items;
}

export const DnsTargetStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  const [credentials] = createResource(fetchCredentials);

  return (
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Which DNS record should we update?</h2>

      <div class="space-y-1">
        <label class="text-sm font-medium">Provider credential</label>
        <Select<ProviderCredentialSummary>
          options={credentials() ?? []}
          optionValue="credentialId"
          optionTextValue={(c) => `${c.label} (${c.provider})`}
          value={credentials()?.find((c) => c.credentialId === props.data.providerCredentialId) ?? null}
          onChange={(c) => props.updateData({ providerCredentialId: c?.credentialId ?? "" })}
          placeholder="Select a credential…"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {itemProps.item.rawValue.label} ({itemProps.item.rawValue.provider})
            </SelectItem>
          )}
        >
          <SelectTrigger>
            <SelectValue<ProviderCredentialSummary>>
              {(state) => state.selectedOption()?.label ?? "Select a credential…"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      <TextField value={props.data.zone} onChange={(value) => props.updateData({ zone: value })}>
        <TextFieldLabel>Hetzner zone ID</TextFieldLabel>
        <TextFieldInput />
      </TextField>

      <TextField value={props.data.recordName} onChange={(value) => props.updateData({ recordName: value })}>
        <TextFieldLabel>Record name</TextFieldLabel>
        <TextFieldInput />
      </TextField>
    </div>
  );
};
