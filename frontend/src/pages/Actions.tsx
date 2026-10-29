import { useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { EmptyState } from "~/components/layout/EmptyState";
import { ActionWizard, type ExistingAction } from "~/flows/action-wizard/ActionWizard";
import { DELIVERY_LABEL, type DeliveryStatusItem } from "~/lib/traefik-providers";
import { api } from "~/services/api";

type AddressFamily = "ipv4" | "ipv6";

type FirewallConfigSummary = {
  providerCredentialId: string;
  firewallId: number;
  direction: string;
  protocol: string;
  port?: string;
  description: string;
};
type DnsConfigSummary = { providerCredentialId: string; zone: string; recordName: string };
type TraefikConfigSummary = { traefikProviderId: string; group: string };
type ActionConfigSummary = DnsConfigSummary | FirewallConfigSummary | TraefikConfigSummary;

interface ActionSummary {
  actionId: string;
  ipClientId: string;
  type: string;
  addressFamilies: AddressFamily[];
  config: ActionConfigSummary | null;
  status: "enabled" | "disabled" | "detached";
}

const ACTION_TYPE_LABEL: Record<string, string> = {
  hetzner_cloud_dns_update: "Hetzner Cloud DNS Update",
  hetzner_cloud_firewall_rule_update: "Hetzner Cloud Firewall Rule Update",
  traefik_config_delivery: "Traefik configuration",
};

function isFirewallConfig(config: ActionConfigSummary | null): config is FirewallConfigSummary {
  return !!config && "firewallId" in config;
}

function isTraefikConfig(config: ActionConfigSummary | null): config is TraefikConfigSummary {
  return !!config && "traefikProviderId" in config;
}

function isDnsConfig(config: ActionConfigSummary | null): config is DnsConfigSummary {
  return !!config && "zone" in config;
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
  const firewall = isFirewallConfig(action.config) ? action.config : null;
  const dns = isDnsConfig(action.config) ? action.config : null;
  const traefik = isTraefikConfig(action.config) ? action.config : null;
  return {
    actionId: action.actionId,
    type: action.type as ExistingAction["type"],
    providerCredentialId: firewall?.providerCredentialId ?? dns?.providerCredentialId ?? "",
    traefikProviderId: traefik?.traefikProviderId ?? "",
    group: traefik?.group ?? "",
    zone: dns?.zone ?? "",
    recordName: dns?.recordName ?? "",
    firewallId: firewall ? String(firewall.firewallId) : "",
    direction: (firewall?.direction as ExistingAction["direction"]) ?? "in",
    protocol: (firewall?.protocol as ExistingAction["protocol"]) ?? "tcp",
    port: firewall?.port ?? "",
    description: firewall?.description ?? "",
    ipv4: action.addressFamilies.includes("ipv4"),
    ipv6: action.addressFamilies.includes("ipv6"),
  };
}

export default function Actions() {
  const params = useParams<{ ipClientId: string }>();

  const [actions, { refetch }] = createResource(
    () => params.ipClientId,
    async (ipClientId) => {
      const res = await api.get<{ items: ActionSummary[] }>(`/ip-clients/${ipClientId}/actions`);
      return res.items;
    },
  );

  // Delivery status comes from its own endpoint, never from the (cached) actions list.
  const [deliveryStatus] = createResource(
    () => ({ id: params.ipClientId, actions: actions() }),
    async ({ id, actions: list }) => {
      if (!list?.some((a) => a.type === "traefik_config_delivery")) return {} as Record<string, DeliveryStatusItem>;
      const res = await api.get<{ items: DeliveryStatusItem[] }>(`/ip-clients/${id}/delivery-status`);
      return Object.fromEntries(res.items.map((item) => [item.actionId, item]));
    },
  );

  const [wizardTarget, setWizardTarget] = createSignal<"new" | ExistingAction | null>(null);
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

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">Actions</h1>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={() => setWizardTarget("new")}>
            Add an action
          </Button>
          <Button as="a" href={`/ip-clients/${params.ipClientId}/history`} size="sm" variant="outline">
            History
          </Button>
          <Button as="a" href={`/ip-clients/${params.ipClientId}/settings`} size="sm" variant="outline">
            Settings
          </Button>
        </div>
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
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <For each={items()}>
                {(action) => {
                  const firewallConfig = () => (isFirewallConfig(action.config) ? action.config : null);
                  const dnsConfig = () => (isDnsConfig(action.config) ? action.config : null);
                  const traefikConfig = () => (isTraefikConfig(action.config) ? action.config : null);
                  const delivery = () => deliveryStatus()?.[action.actionId];
                  return (
                  <Card>
                    <CardContent class="space-y-3 p-4">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-medium">{ACTION_TYPE_LABEL[action.type] ?? action.type}</span>
                        <span class="text-xs text-muted-foreground">{STATUS_LABEL[action.status]}</span>
                      </div>
                      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        <Show when={traefikConfig()}>
                          {(tc) => (
                            <>
                              <dt class="text-muted-foreground">Agent</dt>
                              <dd>{delivery()?.providerName ?? tc().traefikProviderId}</dd>
                              <dt class="text-muted-foreground">Group</dt>
                              <dd>{tc().group}</dd>
                              <Show when={delivery()}>
                                {(d) => (
                                  <>
                                    <dt class="text-muted-foreground">Delivery</dt>
                                    <dd
                                      class={d().status === "error" ? "text-destructive" : ""}
                                      title={d().error?.reason}
                                    >
                                      {DELIVERY_LABEL[d().status]}
                                      <Show when={d().status === "error" && d().error}>
                                        {(e) => <span class="block text-xs">{e().reason}</span>}
                                      </Show>
                                    </dd>
                                  </>
                                )}
                              </Show>
                            </>
                          )}
                        </Show>
                        <Show when={firewallConfig()}>
                          {(fw) => (
                            <>
                              <dt class="text-muted-foreground">Firewall</dt>
                              <dd>{fw().firewallId}</dd>
                              <dt class="text-muted-foreground">Rule</dt>
                              <dd>{fw().description}</dd>
                            </>
                          )}
                        </Show>
                        <Show when={dnsConfig()}>
                          {(dns) => (
                            <>
                              <dt class="text-muted-foreground">Zone</dt>
                              <dd>{dns().zone}</dd>
                              <dt class="text-muted-foreground">Record</dt>
                              <dd>{dns().recordName}</dd>
                            </>
                          )}
                        </Show>
                        <dt class="text-muted-foreground">Families</dt>
                        <dd>{formatAddressFamilies(action.addressFamilies)}</dd>
                      </dl>
                      <Show when={action.type !== "traefik_config_delivery"}>
                        <a href={`/actions/${action.actionId}/executions`} class="text-sm hover:underline">
                          View history
                        </a>
                      </Show>
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
                  );
                }}
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
    </div>
  );
}
