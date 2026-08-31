import { useParams } from "@solidjs/router";
import { createResource, For, Show } from "solid-js";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { api } from "~/services/api";

interface IpClientSummary {
  ipClientId: string;
  label: string;
}

interface ExecutionEntry {
  executionId: string;
  actionId: string;
  status: "running" | "succeeded" | "failed";
  attempt: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
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
}

const STATUS_LABEL: Record<ExecutionEntry["status"], string> = {
  running: "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
};

function executionTime(execution: ExecutionEntry): string {
  return execution.completedAt ?? execution.failedAt ?? execution.startedAt ?? "—";
}

function addressChange(previous: string | undefined, next: string | undefined): string | null {
  if (!next) return null;
  return previous ? `${previous} → ${next}` : next;
}

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

  return (
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{device()?.label ?? "Device"} — reported IP updates</h1>
        <p class="text-sm text-muted-foreground">
          Every confirmed address change this device reported, and what happened as a result. Most recent first.
        </p>
      </div>

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
              <For each={items()}>
                {(change) => (
                  <Card>
                    <CardHeader class="space-y-1">
                      <CardTitle class="font-mono text-sm font-normal text-muted-foreground">{change.time}</CardTitle>
                      <div class="flex flex-col gap-1 text-sm">
                        <Show when={addressChange(change.data.previousIPv4, change.data.newIPv4)}>
                          {(value) => (
                            <div class="flex min-w-0 items-baseline gap-1.5">
                              <span class="shrink-0 text-xs text-muted-foreground">IPv4</span>
                              <span class="min-w-0 truncate font-mono text-xs" title={value()}>
                                {value()}
                              </span>
                            </div>
                          )}
                        </Show>
                        <Show when={addressChange(change.data.previousIPv6, change.data.newIPv6)}>
                          {(value) => (
                            <div class="flex min-w-0 items-baseline gap-1.5">
                              <span class="shrink-0 text-xs text-muted-foreground">IPv6</span>
                              <span class="min-w-0 truncate font-mono text-xs" title={value()}>
                                {value()}
                              </span>
                            </div>
                          )}
                        </Show>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Show
                        when={change.executions.length > 0}
                        fallback={<p class="text-sm text-muted-foreground">No Actions were configured for this change.</p>}
                      >
                        <ul class="space-y-1.5 text-sm">
                          <For each={change.executions}>
                            {(execution) => (
                              <li class="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span class="font-mono text-xs text-muted-foreground">{executionTime(execution)}</span>
                                <span>{STATUS_LABEL[execution.status]}</span>
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
                      </Show>
                    </CardContent>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}
