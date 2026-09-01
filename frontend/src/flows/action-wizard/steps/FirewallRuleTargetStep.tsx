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

/** Same Hetzner Provider Credential type the DNS Action already uses (FR-012). */
const REQUIRED_PROVIDER = "hetzner";

const DIRECTIONS = ["in", "out"] as const;
const PROTOCOLS = ["tcp", "udp", "icmp", "esp", "ah", "gre"] as const;

async function fetchCredentials(): Promise<ProviderCredentialSummary[]> {
  const res = await api.get<{ items: ProviderCredentialSummary[] }>("/provider-credentials");
  return res.items;
}

/** Manual input fields for firewallId + rule selector (Assumptions: no live Hetzner picker in v1). */
export const FirewallRuleTargetStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  const [credentials, { refetch }] = createResource(fetchCredentials);
  const [dialogOpen, setDialogOpen] = createSignal(false);

  const matchingCredentials = () => (credentials() ?? []).filter((c) => c.provider === REQUIRED_PROVIDER);
  const portApplies = () => props.data.protocol === "tcp" || props.data.protocol === "udp";

  async function handleCreated(credential: CreatedCredential) {
    setDialogOpen(false);
    await refetch();
    props.updateData({ providerCredentialId: credential.credentialId });
  }

  return (
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Which firewall rule should we update?</h2>

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
              You don't have a {credentialTypeLabel(REQUIRED_PROVIDER)} yet.{" "}
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

      <TextField value={props.data.firewallId} onChange={(value) => props.updateData({ firewallId: value })}>
        <TextFieldLabel>Hetzner firewall ID</TextFieldLabel>
        <TextFieldInput type="number" />
      </TextField>

      <div class="space-y-1">
        <label class="text-sm font-medium">Direction</label>
        <Select<(typeof DIRECTIONS)[number]>
          options={[...DIRECTIONS]}
          value={props.data.direction}
          onChange={(value) => value && props.updateData({ direction: value })}
          itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>}
        >
          <SelectTrigger>
            <SelectValue<(typeof DIRECTIONS)[number]>>{(state) => state.selectedOption()}</SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      <div class="space-y-1">
        <label class="text-sm font-medium">Protocol</label>
        <Select<(typeof PROTOCOLS)[number]>
          options={[...PROTOCOLS]}
          value={props.data.protocol}
          onChange={(value) => value && props.updateData({ protocol: value, port: portApplies() ? props.data.port : "" })}
          itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue}</SelectItem>}
        >
          <SelectTrigger>
            <SelectValue<(typeof PROTOCOLS)[number]>>{(state) => state.selectedOption()}</SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
      </div>

      <Show when={portApplies()}>
        <TextField value={props.data.port} onChange={(value) => props.updateData({ port: value })}>
          <TextFieldLabel>Port</TextFieldLabel>
          <TextFieldInput />
        </TextField>
      </Show>

      <TextField value={props.data.description} onChange={(value) => props.updateData({ description: value })}>
        <TextFieldLabel>Rule description</TextFieldLabel>
        <TextFieldInput />
      </TextField>
      <p class="text-sm text-muted-foreground">
        Must match the description of an existing rule on this firewall exactly — direction, protocol, port, and
        description together must identify exactly one rule (FR-003).
      </p>

      <CredentialFormDialog open={dialogOpen()} onOpenChange={setDialogOpen} onCreated={(c) => void handleCreated(c)} />
    </div>
  );
};
