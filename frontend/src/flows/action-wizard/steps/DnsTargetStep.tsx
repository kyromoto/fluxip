import { createResource, createSignal, Show, type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { CredentialFormDialog, type CreatedCredential } from "~/components/credentials/CredentialFormDialog";
import { credentialTypeLabel } from "~/lib/credential-types";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import { api } from "~/services/api";
import type { ActionWizardData } from "../ActionWizard";

interface ProviderCredentialSummary {
  credentialId: string;
  provider: string;
  label: string;
}

/** Credential Type required by each Action type (FR-011) — only one Action type exists today. */
const REQUIRED_PROVIDER: Record<ActionWizardData["type"], string> = {
  update_dns_record: "hetzner",
};

async function fetchCredentials(): Promise<ProviderCredentialSummary[]> {
  const res = await api.get<{ items: ProviderCredentialSummary[] }>("/provider-credentials");
  return res.items;
}

export const DnsTargetStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  const [credentials, { refetch }] = createResource(fetchCredentials);
  const [dialogOpen, setDialogOpen] = createSignal(false);

  const requiredProvider = () => REQUIRED_PROVIDER[props.data.type];
  const matchingCredentials = () => (credentials() ?? []).filter((c) => c.provider === requiredProvider());

  async function handleCreated(credential: CreatedCredential) {
    setDialogOpen(false);
    await refetch();
    props.updateData({ providerCredentialId: credential.credentialId });
  }

  return (
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Which DNS record should we update?</h2>

      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Provider credential</label>
          <Button type="button" variant="link" size="sm" class="h-auto p-0" onClick={() => setDialogOpen(true)}>
            Add a new credential
          </Button>
        </div>

        <Show
          when={matchingCredentials().length > 0}
          fallback={
            <div class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              You don't have a {credentialTypeLabel(requiredProvider())} yet.{" "}
              <Button type="button" variant="link" size="sm" class="h-auto p-0" onClick={() => setDialogOpen(true)}>
                Add one now
              </Button>{" "}
              to continue.
            </div>
          }
        >
          <Select<ProviderCredentialSummary>
            options={matchingCredentials()}
            optionValue="credentialId"
            optionTextValue={(c) => c.label}
            value={matchingCredentials().find((c) => c.credentialId === props.data.providerCredentialId) ?? null}
            onChange={(c) => props.updateData({ providerCredentialId: c?.credentialId ?? "" })}
            placeholder="Select a credential…"
            itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>}
          >
            <SelectTrigger>
              <SelectValue<ProviderCredentialSummary>>
                {(state) => state.selectedOption()?.label ?? "Select a credential…"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </Show>
      </div>

      <TextField value={props.data.zone} onChange={(value) => props.updateData({ zone: value })}>
        <TextFieldLabel>Hetzner zone ID</TextFieldLabel>
        <TextFieldInput />
      </TextField>

      <TextField value={props.data.recordName} onChange={(value) => props.updateData({ recordName: value })}>
        <TextFieldLabel>Record name</TextFieldLabel>
        <TextFieldInput />
      </TextField>

      <CredentialFormDialog open={dialogOpen()} onOpenChange={setDialogOpen} onCreated={(c) => void handleCreated(c)} />
    </div>
  );
};
