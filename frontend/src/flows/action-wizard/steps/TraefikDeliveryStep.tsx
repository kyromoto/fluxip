import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import type { WizardStepComponentProps } from "~/flows/wizard/useWizard";
import { GROUP_PATTERN, type TraefikProviderDetail, type TraefikProviderSummary } from "~/lib/traefik-providers";
import { api } from "~/services/api";
import type { ActionWizardData } from "../ActionWizard";

async function fetchProviders(): Promise<TraefikProviderSummary[]> {
  const res = await api.get<{ items: TraefikProviderSummary[] }>("/agents");
  return res.items;
}

/** Choose the provider (only the account's own are ever listed) and the group the device belongs to (FR-010). */
export const TraefikDeliveryStep: Component<WizardStepComponentProps<ActionWizardData>> = (props) => {
  const [providers] = createResource(fetchProviders);
  const [detail] = createResource(
    () => props.data.traefikProviderId || null,
    (id) => api.get<TraefikProviderDetail>(`/agents/${id}`),
  );
  const [typing, setTyping] = createSignal(false);

  const suggestions = createMemo(() => detail()?.groups ?? []);
  const groupInvalid = () => props.data.group.length > 0 && !GROUP_PATTERN.test(props.data.group.trim());

  return (
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Which agent should get this device's address?</h2>

      <div class="space-y-1">
        <label class="text-sm font-medium">Agent</label>
        <Show
          when={(providers() ?? []).length > 0}
          fallback={
            <div class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {providers.loading ? (
                "Loading…"
              ) : (
                <>
                  You don't have an agent yet.{" "}
                  <a href="/agents" class="touch-target inline-flex items-center underline">
                    Add one first
                  </a>
                  , then come back.
                </>
              )}
            </div>
          }
        >
          <Select<TraefikProviderSummary>
            options={providers() ?? []}
            optionValue="providerId"
            optionTextValue={(p) => p.name}
            value={(providers() ?? []).find((p) => p.providerId === props.data.traefikProviderId) ?? null}
            onChange={(p) => props.updateData({ traefikProviderId: p?.providerId ?? "", group: "" })}
            placeholder="Select an agent…"
            itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue.name}</SelectItem>}
          >
            <SelectTrigger>
              <SelectValue<TraefikProviderSummary>>{(state) => state.selectedOption()?.name ?? "Select an agent…"}</SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        </Show>
      </div>

      <Show when={props.data.traefikProviderId}>
        <div class="space-y-2">
          <TextField value={props.data.group} onChange={(value) => props.updateData({ group: value.toLowerCase() })}>
            <TextFieldLabel>Group</TextFieldLabel>
            <TextFieldInput
              placeholder="e.g. admin-allowlist"
              maxLength={63}
              aria-invalid={groupInvalid()}
              onFocus={() => setTyping(true)}
            />
          </TextField>
          <p class="text-sm text-muted-foreground">
            Templates on the agent pick devices by this name. Devices with the same group end up in the same list.
          </p>
          <Show when={groupInvalid()}>
            <p class="text-sm text-destructive" role="alert">
              Use lowercase letters, digits, "." "_" or "-", starting with a letter or digit (up to 63 characters).
            </p>
          </Show>
          <Show when={suggestions().length > 0}>
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="text-muted-foreground">Already used:</span>
              <For each={suggestions()}>
                {(name) => (
                  <Button
                    type="button"
                    size="sm"
                    variant={props.data.group === name ? "default" : "outline"}
                    onClick={() => {
                      setTyping(false);
                      props.updateData({ group: name });
                    }}
                  >
                    {name}
                  </Button>
                )}
              </For>
            </div>
          </Show>
          <Show when={typing() && props.data.group.length > 0 && !groupInvalid() && suggestions().length > 0 && !suggestions().includes(props.data.group)}>
            <p class="text-sm text-amber-600 dark:text-amber-400">
              This creates a new group. If you meant one of the existing ones, pick it above to avoid a typo.
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
};
