import { useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { EmptyState } from "~/components/layout/EmptyState";
import { ActionWizard, type ExistingAction } from "~/flows/action-wizard/ActionWizard";
import { ReviewCredentialStep } from "~/flows/device-wizard/steps/ReviewCredentialStep";
import { api } from "~/services/api";

type AddressFamily = "ipv4" | "ipv6";

interface IpClientSummary {
  ipClientId: string;
  status: "enabled" | "disabled" | "decommissioned";
}

interface ActionSummary {
  actionId: string;
  ipClientId: string;
  type: string;
  addressFamilies: AddressFamily[];
  config: { providerCredentialId: string; zone: string; recordName: string } | null;
  status: "enabled" | "disabled" | "detached";
}

const STATUS_LABEL: Record<ActionSummary["status"], string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  detached: "Detached",
};

const ADDRESS_FAMILY_LABEL: Record<AddressFamily, string> = {
  ipv4: "IPv4",
  ipv6: "IPv6",
};

function formatAddressFamilies(families: AddressFamily[]): string {
  return families.map((f) => ADDRESS_FAMILY_LABEL[f]).join(" and ");
}

function toExistingAction(action: ActionSummary): ExistingAction {
  return {
    actionId: action.actionId,
    providerCredentialId: action.config?.providerCredentialId ?? "",
    zone: action.config?.zone ?? "",
    recordName: action.config?.recordName ?? "",
    ipv4: action.addressFamilies.includes("ipv4"),
    ipv6: action.addressFamilies.includes("ipv6"),
  };
}

export default function Actions() {
  const params = useParams<{ ipClientId: string }>();

  const [device, { refetch: refetchDevice }] = createResource(
    () => params.ipClientId,
    (ipClientId) => api.get<IpClientSummary>(`/ip-clients/${ipClientId}`),
  );

  const [actions, { refetch }] = createResource(
    () => params.ipClientId,
    async (ipClientId) => {
      const res = await api.get<{ items: ActionSummary[] }>(`/ip-clients/${ipClientId}/actions`);
      return res.items;
    },
  );

  const [wizardTarget, setWizardTarget] = createSignal<"new" | ExistingAction | null>(null);
  const [rotatedCredential, setRotatedCredential] = createSignal<{ username: string; password: string } | null>(
    null,
  );
  const [error, setError] = createSignal<unknown>(null);

  async function handleWizardDone() {
    setWizardTarget(null);
    await refetch();
  }

  async function handleToggle(actionId: string, status: ActionSummary["status"]) {
    setError(null);
    try {
      await api.post(`/actions/${actionId}/${status === "enabled" ? "disable" : "enable"}`);
      await refetch();
    } catch (err) {
      setError(err);
    }
  }

  async function handleDetach(actionId: string) {
    setError(null);
    if (!confirm("Detach this action? This is irreversible.")) return;
    try {
      await api.delete(`/actions/${actionId}`);
      await refetch();
    } catch (err) {
      setError(err);
    }
  }

  async function handleDeviceToggle(status: IpClientSummary["status"]) {
    setError(null);
    try {
      await api.post(`/ip-clients/${params.ipClientId}/${status === "enabled" ? "disable" : "enable"}`);
      await refetchDevice();
    } catch (err) {
      setError(err);
    }
  }

  async function handleDeviceRotate() {
    setError(null);
    try {
      const result = await api.post<{ reportingCredential: { username: string; password: string } }>(
        `/ip-clients/${params.ipClientId}/rotate-credential`,
      );
      setRotatedCredential(result.reportingCredential);
    } catch (err) {
      setError(err);
    }
  }

  async function handleDeviceDecommission() {
    setError(null);
    if (!confirm("Decommission this device? This is irreversible.")) return;
    try {
      await api.delete(`/ip-clients/${params.ipClientId}`);
      await refetchDevice();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center gap-2 border-b pb-4">
        <Button as="a" href={`/ip-clients/${params.ipClientId}/history`} size="sm" variant="outline">
          Reported updates
        </Button>
        <Show when={device()}>
          {(client) => (
            <Show when={client().status !== "decommissioned"}>
              <Button size="sm" variant="outline" onClick={() => handleDeviceToggle(client().status)}>
                {client().status === "enabled" ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleDeviceRotate()}>
                Rotate credential
              </Button>
              <Button size="sm" variant="destructive" onClick={() => handleDeviceDecommission()}>
                Decommission
              </Button>
            </Show>
          )}
        </Show>
      </div>

      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">Actions</h1>
        <Button onClick={() => setWizardTarget("new")}>Add an action</Button>
      </div>

      <Show when={error()}>
        <ErrorMessage error={error()} />
      </Show>

      <Show when={actions()} fallback={<p class="text-muted-foreground">Loading…</p>}>
        {(items) => (
          <Show
            when={items().length > 0}
            fallback={
              <EmptyState
                message="This device has no actions configured yet."
                actionLabel="Add your first action"
                onAction={() => setWizardTarget("new")}
              />
            }
          >
            <div class="space-y-3">
              <For each={items()}>
                {(action) => (
                  <Card>
                    <CardContent class="space-y-3 p-4">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-medium">Update DNS record</span>
                        <span class="text-xs text-muted-foreground">{STATUS_LABEL[action.status]}</span>
                      </div>
                      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        <dt class="text-muted-foreground">Zone</dt>
                        <dd>{action.config?.zone}</dd>
                        <dt class="text-muted-foreground">Record</dt>
                        <dd>{action.config?.recordName}</dd>
                        <dt class="text-muted-foreground">Families</dt>
                        <dd>{formatAddressFamilies(action.addressFamilies)}</dd>
                      </dl>
                      <a href={`/actions/${action.actionId}/executions`} class="text-sm hover:underline">
                        View history
                      </a>
                      <Show when={action.status !== "detached"}>
                        <div class="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => setWizardTarget(toExistingAction(action))}>
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleToggle(action.actionId, action.status)}>
                            {action.status === "enabled" ? "Disable" : "Enable"}
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDetach(action.actionId)}>
                            Detach
                          </Button>
                        </div>
                      </Show>
                    </CardContent>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>

      <Dialog open={wizardTarget() !== null} onOpenChange={(open) => !open && setWizardTarget(null)}>
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle class="sr-only">
              {wizardTarget() === "new" ? "Add an action" : "Reconfigure action"}
            </DialogTitle>
          </DialogHeader>
          <Show when={wizardTarget()}>
            {(target) => (
              <ActionWizard
                ipClientId={params.ipClientId}
                existingAction={target() === "new" ? undefined : (target() as ExistingAction)}
                onDone={() => void handleWizardDone()}
                onCancel={() => setWizardTarget(null)}
              />
            )}
          </Show>
        </DialogContent>
      </Dialog>

      <Dialog open={rotatedCredential() !== null} onOpenChange={(open) => !open && setRotatedCredential(null)}>
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle class="sr-only">New reporting credential</DialogTitle>
          </DialogHeader>
          <Show when={rotatedCredential()}>
            {(credential) => (
              <ReviewCredentialStep
                username={credential().username}
                password={credential().password}
                onDone={() => setRotatedCredential(null)}
              />
            )}
          </Show>
        </DialogContent>
      </Dialog>
    </div>
  );
}
