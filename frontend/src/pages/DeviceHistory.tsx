import { useParams } from "@solidjs/router";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { ExecutionStatusIcon, type ExecutionStatus } from "~/components/history/ExecutionStatusIcon";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { PageHeader } from "~/components/layout/PageHeader";
import { api } from "~/services/api";

interface IpClientSummary {
  ipClientId: string;
  label: string;
}

interface ExecutionEntry {
  executionId: string;
  actionId: string;
  action: {
    type: string | null;
    zone?: string;
    recordName?: string;
    firewallId?: number;
    description?: string;
  };
  status: "running" | "succeeded" | "failed";
  attempt: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

interface TraefikDelivery {
  actionId: string;
  providerName: string | null;
  group: string;
  kind: "delivered" | "combined";
  stage: "published" | "applied" | "failed" | null;
  at: string | null;
  error: string | null;
}

interface IpChangeEntry {
  ipChangedEventId: string;
  time: string;
  data: {
    previousIPv4?: string;
    newIPv4?: string;
    previousIPv6?: string;
    newIPv6?: string;
  };
  executions: ExecutionEntry[];
  /** Traefik deliveries never run as executions, so they come separately. Absent on older backends. */
  deliveries?: TraefikDelivery[];
}

const DELIVERY_STAGE: Record<NonNullable<TraefikDelivery["stage"]>, { label: string; status: ExecutionStatus }> = {
  published: { label: "Published, awaiting agent", status: "running" },
  applied: { label: "Applied", status: "succeeded" },
  failed: { label: "Failed", status: "failed" },
};

const ACTION_TYPE_LABEL: Record<string, string> = {
  hetzner_cloud_dns_update: "Hetzner Cloud DNS Update",
  hetzner_cloud_firewall_rule_update: "Hetzner Cloud Firewall Rule Update",
};

function actionLabel(action: ExecutionEntry["action"]): string {
  const type = action.type ? (ACTION_TYPE_LABEL[action.type] ?? action.type) : "Action";
  const target =
    action.zone && action.recordName
      ? `${action.recordName}.${action.zone}`
      : action.firewallId !== undefined
        ? `Firewall ${action.firewallId}${action.description ? ` · ${action.description}` : ""}`
        : null;
  return target ? `${type} — ${target}` : type;
}

function executionTime(execution: ExecutionEntry): string {
  return execution.completedAt ?? execution.failedAt ?? execution.startedAt ?? "—";
}

function addressChange(previous: string | undefined, next: string | undefined): { previous?: string; next: string } | null {
  return next ? { previous, next } : null;
}

/** "old → new" with a drawn arrow, so it sits on the vertical middle of the text (the "→" glyph rides low). */
function AddressChange(props: { family: "IPv4" | "IPv6"; change: { previous?: string; next: string } }) {
  const title = () => (props.change.previous ? `${props.change.previous} → ${props.change.next}` : props.change.next);
  return (
    <div class="flex min-w-0 items-center gap-1.5">
      <span class="shrink-0 text-xs text-muted-foreground">{props.family}</span>
      <span class="flex min-w-0 items-center gap-1.5 font-mono text-xs" title={title()}>
        <Show when={props.change.previous}>
          {(previous) => (
            <>
              <span class="min-w-0 truncate">{previous()}</span>
              <svg
                class="h-3 w-3 shrink-0 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-label="changed to"
                role="img"
                data-testid="address-arrow"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </>
          )}
        </Show>
        <span class="min-w-0 truncate">{props.change.next}</span>
      </span>
    </div>
  );
}

/** One Traefik delivery of an IP change. Not an execution: the agent applies the snapshot later and elsewhere. */
function DeliveryRow(props: { delivery: TraefikDelivery }) {
  const stage = () => (props.delivery.stage ? DELIVERY_STAGE[props.delivery.stage] : null);
  return (
    <li class="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="delivery-row">
      <Show when={props.delivery.at}>
        {(at) => <span class="font-mono text-xs text-muted-foreground">{at()}</span>}
      </Show>
      <Show when={stage()}>
        {(current) => <ExecutionStatusIcon status={current().status} label={current().label} />}
      </Show>
      <span class="font-medium">
        Traefik delivery — {props.delivery.providerName ?? "Agent no longer exists"} · {props.delivery.group}
      </span>
      <Show
        when={stage()}
        fallback={<span class="text-xs text-muted-foreground">Delivered together with a later change</span>}
      >
        {(current) => <span class="text-xs text-muted-foreground">{current().label}</span>}
      </Show>
      <Show when={props.delivery.error}>
        {(error) => <span class="text-xs text-muted-foreground">— {error()}</span>}
      </Show>
    </li>
  );
}

const PAGE_SIZES = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

export default function DeviceHistory() {
  const params = useParams<{ ipClientId: string }>();

  const [device] = createResource(
    () => params.ipClientId,
    (ipClientId) => api.get<IpClientSummary>(`/ip-clients/${ipClientId}`),
  );

  const [changes] = createResource(
    () => params.ipClientId,
    async (ipClientId) => {
      const res = await api.get<{ items: IpChangeEntry[] }>(`/ip-clients/${ipClientId}/history`);
      // Backend returns oldest-first (event order); most-recent-first reads better as a history feed.
      return [...res.items].reverse();
    },
  );

  // Newest first, so page 1 always shows the latest changes.
  const [pageSize, setPageSize] = createSignal<number>(DEFAULT_PAGE_SIZE);
  const [requestedPage, setRequestedPage] = createSignal(1);
  const totalPages = createMemo(() => Math.max(1, Math.ceil((changes()?.length ?? 0) / pageSize())));
  // Clamped, so a shrinking list or a bigger page size never leaves the user on a page that no longer exists.
  const page = createMemo(() => Math.min(requestedPage(), totalPages()));
  const visible = createMemo(() => {
    const start = (page() - 1) * pageSize();
    return (changes() ?? []).slice(start, start + pageSize());
  });

  return (
    <div class="space-y-6">
      <PageHeader title={`${device()?.label ?? "Device"} — History`} />
      <p class="text-sm text-muted-foreground">
        Every confirmed address change this device reported, and what happened as a result. Most recent first.
      </p>

      <Show when={changes()} fallback={<p class="text-muted-foreground">Loading…</p>}>
        {(items) => (
          <Show
            when={items().length > 0}
            fallback={
              <Card class="border-dashed">
                <CardContent class="py-10 text-center text-muted-foreground">
                  This device hasn't reported an address change yet.
                </CardContent>
              </Card>
            }
          >
            <div class="space-y-4">
              <For each={visible()}>
                {(change) => (
                  <Card>
                    <CardHeader class="space-y-1">
                      <CardTitle class="font-mono text-sm font-normal text-muted-foreground">{change.time}</CardTitle>
                      <div class="flex flex-col gap-1 text-sm">
                        <Show when={addressChange(change.data.previousIPv4, change.data.newIPv4)}>
                          {(value) => <AddressChange family="IPv4" change={value()} />}
                        </Show>
                        <Show when={addressChange(change.data.previousIPv6, change.data.newIPv6)}>
                          {(value) => <AddressChange family="IPv6" change={value()} />}
                        </Show>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Show
                        when={change.executions.length > 0 || (change.deliveries ?? []).length > 0}
                        fallback={<p class="text-sm text-muted-foreground">No Actions were configured for this change.</p>}
                      >
                        <ul class="space-y-1.5 text-sm">
                          <For each={change.executions}>
                            {(execution) => (
                              <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span class="font-mono text-xs text-muted-foreground">{executionTime(execution)}</span>
                                <ExecutionStatusIcon status={execution.status} />
                                <span class="font-medium">{actionLabel(execution.action)}</span>
                                <Show when={execution.attempt > 1}>
                                  <span class="text-xs text-muted-foreground">attempt {execution.attempt}</span>
                                </Show>
                                <Show when={execution.error}>
                                  {(error) => <span class="text-xs text-muted-foreground">— {error()}</span>}
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                        <Show when={(change.deliveries ?? []).length > 0}>
                          <ul class="space-y-1.5 text-sm" classList={{ "mt-3 border-t pt-3": change.executions.length > 0 }} aria-label="Traefik deliveries">
                            <For each={change.deliveries}>{(delivery) => <DeliveryRow delivery={delivery} />}</For>
                          </ul>
                        </Show>
                      </Show>
                    </CardContent>
                  </Card>
                )}
              </For>
            </div>
            <Show when={items().length > PAGE_SIZES[0]}>
              <nav class="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pagination">
                <label class="flex items-center gap-2 text-muted-foreground">
                  Per page
                  <select
                    class="h-9 rounded-md border border-input bg-background px-2 text-foreground max-md:h-11 max-md:min-w-11"
                    value={pageSize()}
                    onChange={(e) => {
                      setPageSize(Number(e.currentTarget.value));
                      setRequestedPage(1);
                    }}
                  >
                    <For each={PAGE_SIZES}>{(size) => <option value={size}>{size}</option>}</For>
                  </select>
                </label>
                <div class="flex items-center gap-3">
                  <span class="text-muted-foreground">
                    Page {page()} of {totalPages()}
                  </span>
                  <Button size="sm" variant="outline" disabled={page() <= 1} onClick={() => setRequestedPage(page() - 1)}>
                    Newer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page() >= totalPages()}
                    onClick={() => setRequestedPage(page() + 1)}
                  >
                    Older
                  </Button>
                </div>
              </nav>
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );
}
