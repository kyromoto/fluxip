import { useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { api } from "~/services/api";

interface ExecutionSummary {
  executionId: string;
  actionId: string;
  ipClientId: string;
  triggeredBy: "ip_change" | "manual";
  ipValuesUsed: { ipv4?: string; ipv6?: string };
  status: "running" | "succeeded" | "failed";
  attempt: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

function executionTime(execution: ExecutionSummary): string {
  return execution.completedAt ?? execution.failedAt ?? execution.startedAt ?? "—";
}

const TRIGGERED_BY_LABEL: Record<ExecutionSummary["triggeredBy"], string> = {
  ip_change: "Automatic (address changed)",
  manual: "Manual re-run",
};

const STATUS_LABEL: Record<ExecutionSummary["status"], string> = {
  running: "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
};

export default function ExecutionHistory() {
  const params = useParams<{ actionId: string }>();
  const [executions, { refetch }] = createResource(
    () => params.actionId,
    async (actionId) => {
      const res = await api.get<{ items: ExecutionSummary[] }>(`/actions/${actionId}/executions`);
      return res.items;
    },
  );
  const [error, setError] = createSignal<unknown>(null);
  const [rerunning, setRerunning] = createSignal(false);

  async function handleRerun() {
    setError(null);
    setRerunning(true);
    try {
      await api.post(`/actions/${params.actionId}/run`);
      await refetch();
    } catch (err) {
      setError(err);
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">Update history</h1>
        <Button onClick={() => void handleRerun()} disabled={rerunning()}>
          {rerunning() ? "Re-running…" : "Re-run using last known address"}
        </Button>
      </div>

      <Show when={error()}>
        <ErrorMessage error={error()} />
      </Show>

      <Show when={executions()} fallback={<p class="text-muted-foreground">Loading…</p>}>
        {(items) => (
          <>
            <div class="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Triggered by</TableHead>
                    <TableHead>Address used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <For each={items()}>
                    {(execution) => (
                      <TableRow>
                        <TableCell class="font-mono text-xs">{executionTime(execution)}</TableCell>
                        <TableCell>{TRIGGERED_BY_LABEL[execution.triggeredBy]}</TableCell>
                        <TableCell class="font-mono text-xs">
                          {execution.ipValuesUsed.ipv4 ?? "—"} / {execution.ipValuesUsed.ipv6 ?? "—"}
                        </TableCell>
                        <TableCell>{STATUS_LABEL[execution.status]}</TableCell>
                        <TableCell>{execution.attempt}</TableCell>
                        <TableCell>{execution.error ?? "—"}</TableCell>
                      </TableRow>
                    )}
                  </For>
                </TableBody>
              </Table>
            </div>

            <div class="space-y-3 md:hidden">
              <For each={items()}>
                {(execution) => (
                  <Card>
                    <CardContent class="space-y-2 p-4 text-sm">
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-medium">{TRIGGERED_BY_LABEL[execution.triggeredBy]}</span>
                        <span class="text-xs text-muted-foreground">{STATUS_LABEL[execution.status]}</span>
                      </div>
                      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <dt class="text-muted-foreground">Time</dt>
                        <dd class="font-mono text-xs">{executionTime(execution)}</dd>
                        <dt class="text-muted-foreground">Address used</dt>
                        <dd class="font-mono text-xs">
                          {execution.ipValuesUsed.ipv4 ?? "—"} / {execution.ipValuesUsed.ipv6 ?? "—"}
                        </dd>
                        <dt class="text-muted-foreground">Attempt</dt>
                        <dd>{execution.attempt}</dd>
                        <Show when={execution.error}>
                          <dt class="text-muted-foreground">Details</dt>
                          <dd>{execution.error}</dd>
                        </Show>
                      </dl>
                    </CardContent>
                  </Card>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
