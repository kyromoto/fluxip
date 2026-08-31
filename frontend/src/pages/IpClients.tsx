import { createResource, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { EmptyState } from "~/components/layout/EmptyState";
import { DeviceWizard } from "~/flows/device-wizard/DeviceWizard";
import { ReviewCredentialStep } from "~/flows/device-wizard/steps/ReviewCredentialStep";
import { api } from "~/services/api";
import { cn } from "~/lib/cn";

interface IpClientSummary {
  ipClientId: string;
  label: string;
  status: "enabled" | "disabled" | "decommissioned";
  lastKnownIPv4: string | null;
  lastKnownIPv6: string | null;
  notificationPreference: "off" | "failures_only" | "all";
}

async function fetchIpClients(): Promise<IpClientSummary[]> {
  const res = await api.get<{ items: IpClientSummary[] }>("/ip-clients");
  return res.items;
}

const STATUS_LABEL: Record<IpClientSummary["status"], string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  decommissioned: "Decommissioned",
};

const NOTIFICATION_LABEL: Record<IpClientSummary["notificationPreference"], string> = {
  off: "Off",
  failures_only: "Failures only",
  all: "All updates",
};

export default function IpClients() {
  const [ipClients, { refetch }] = createResource(fetchIpClients);
  const [wizardOpen, setWizardOpen] = createSignal(false);
  const [rotatedCredential, setRotatedCredential] = createSignal<{ username: string; password: string } | null>(
    null,
  );
  const [error, setError] = createSignal<unknown>(null);

  function openWizard() {
    setError(null);
    setWizardOpen(true);
  }

  async function handleWizardDone() {
    setWizardOpen(false);
    await refetch();
  }

  async function handleToggle(ipClientId: string, status: IpClientSummary["status"]) {
    setError(null);
    try {
      await api.post(`/ip-clients/${ipClientId}/${status === "enabled" ? "disable" : "enable"}`);
      await refetch();
    } catch (err) {
      setError(err);
    }
  }

  async function handleRotate(ipClientId: string) {
    setError(null);
    try {
      const result = await api.post<{ reportingCredential: { username: string; password: string } }>(
        `/ip-clients/${ipClientId}/rotate-credential`,
      );
      setRotatedCredential(result.reportingCredential);
    } catch (err) {
      setError(err);
    }
  }

  async function handleDecommission(ipClientId: string) {
    setError(null);
    if (!confirm("Decommission this device? This is irreversible.")) return;
    try {
      await api.delete(`/ip-clients/${ipClientId}`);
      await refetch();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">Devices</h1>
        <Button onClick={openWizard}>Add a device</Button>
      </div>

      <Show when={error()}>
        <ErrorMessage error={error()} />
      </Show>

      <Show when={ipClients()} fallback={<p class="text-muted-foreground">Loading…</p>}>
        {(items) => (
          <Show
            when={items().length > 0}
            fallback={
              <EmptyState
                message="You haven't added any devices yet."
                actionLabel="Add your first device"
                onAction={openWizard}
              />
            }
          >
            {/* Card grid at every width — multi-column on desktop, single column stacked on mobile (FR-001/FR-016). */}
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <For each={items()}>
                {(client) => (
                  <Card class="flex flex-col">
                    <CardHeader>
                      <div class="flex items-center justify-between gap-2">
                        <CardTitle class="text-base">
                          <a href={`/ip-clients/${client.ipClientId}/actions`} class="hover:underline">
                            {client.label}
                          </a>
                        </CardTitle>
                        <span
                          class={cn(
                            "text-xs",
                            client.status === "enabled" ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {STATUS_LABEL[client.status]}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent class="flex-1">
                      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        <dt class="text-muted-foreground">Last IPv4</dt>
                        <dd class="font-mono text-xs">{client.lastKnownIPv4 ?? "—"}</dd>
                        <dt class="text-muted-foreground">Last IPv6</dt>
                        <dd class="font-mono text-xs">{client.lastKnownIPv6 ?? "—"}</dd>
                        <dt class="text-muted-foreground">Notifications</dt>
                        <dd>{NOTIFICATION_LABEL[client.notificationPreference]}</dd>
                      </dl>
                    </CardContent>
                    <CardFooter class="flex flex-wrap gap-2">
                      <Button as="a" href={`/ip-clients/${client.ipClientId}/history`} size="sm" variant="outline">
                        Reported updates
                      </Button>
                      <Show when={client.status !== "decommissioned"}>
                        <Button size="sm" variant="outline" onClick={() => handleToggle(client.ipClientId, client.status)}>
                          {client.status === "enabled" ? "Disable" : "Enable"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleRotate(client.ipClientId)}>
                          Rotate credential
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDecommission(client.ipClientId)}>
                          Decommission
                        </Button>
                      </Show>
                    </CardFooter>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>

      <Dialog open={wizardOpen()} onOpenChange={setWizardOpen}>
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle class="sr-only">Add a device</DialogTitle>
          </DialogHeader>
          <DeviceWizard onDone={() => void handleWizardDone()} onCancel={() => setWizardOpen(false)} />
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
