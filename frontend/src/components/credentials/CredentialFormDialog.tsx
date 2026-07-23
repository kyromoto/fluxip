import { createSignal, Show, type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { credentialTypeLabel } from "~/lib/credential-types";
import { api } from "~/services/api";

export interface CreatedCredential {
  credentialId: string;
  provider: string;
  label: string;
  secretLast4: string;
}

interface CredentialTypeOption {
  value: string;
}

/** Only Credential Type available today (FR-005/FR-002); adding a second is just a new array entry. */
const CREDENTIAL_TYPES: CredentialTypeOption[] = [{ value: "hetzner" }];

interface CredentialFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (credential: CreatedCredential) => void;
}

/**
 * Shared create-credential form (contracts/credential-selection-ui.md) — used by both the
 * standalone Credentials page (User Story 1) and the Action wizard's empty-state/add-another
 * affordance (User Story 2). Owns its own Dialog so either caller can mount it directly.
 */
export const CredentialFormDialog: Component<CredentialFormDialogProps> = (props) => {
  const [provider, setProvider] = createSignal<CredentialTypeOption>(CREDENTIAL_TYPES[0]);
  const [label, setLabel] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);

  function reset() {
    setProvider(CREDENTIAL_TYPES[0]);
    setLabel("");
    setSecret("");
    setError(null);
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    props.onOpenChange(open);
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!label().trim() || !secret().trim() || isSubmitting()) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const created = await api.post<CreatedCredential>("/provider-credentials", {
        provider: provider().value,
        label: label().trim(),
        secret: secret(),
      });
      reset();
      props.onCreated(created);
    } catch (err) {
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a credential</DialogTitle>
        </DialogHeader>
        <form class="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <Show when={error()}>
            <ErrorMessage error={error()} />
          </Show>

          <div class="space-y-1">
            <label class="text-sm font-medium">Credential type</label>
            <Select<CredentialTypeOption>
              options={CREDENTIAL_TYPES}
              optionValue="value"
              optionTextValue={(o) => credentialTypeLabel(o.value)}
              value={provider()}
              onChange={(o) => o && setProvider(o)}
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}>{credentialTypeLabel(itemProps.item.rawValue.value)}</SelectItem>
              )}
            >
              <SelectTrigger>
                <SelectValue<CredentialTypeOption>>
                  {(state) => credentialTypeLabel(state.selectedOption()?.value ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          <TextField value={label()} onChange={setLabel}>
            <TextFieldLabel>Name</TextFieldLabel>
            <TextFieldInput placeholder="e.g. Hetzner Hauptaccount" />
          </TextField>

          <TextField value={secret()} onChange={setSecret}>
            <TextFieldLabel>API token</TextFieldLabel>
            <TextFieldInput type="password" autocomplete="off" />
          </TextField>

          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!label().trim() || !secret().trim() || isSubmitting()}>
              {isSubmitting() ? "Saving…" : "Add credential"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
