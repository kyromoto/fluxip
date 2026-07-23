import { useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../services/api";

interface ExecutionSummary {
  executionId: string;
  actionId: string;
  ipClientId: string;
  triggeredBy: "ip_change" | "manual";
  ipValuesUsed: { ipv4?: string; ipv6?: string };
  status: "running" | "succeeded" | "failed";
  attempt: number;
  error: string | null;
}

export default function ExecutionHistory() {
  const params = useParams<{ actionId: string }>();
  const [executions, { refetch }] = createResource(
    () => params.actionId,
    async (actionId) => {
      const res = await api.get<{ items: ExecutionSummary[] }>(`/actions/${actionId}/executions`);
      return res.items;
    },
  );
  const [error, setError] = createSignal<string | null>(null);
  const [rerunning, setRerunning] = createSignal(false);

  async function handleRerun() {
    setError(null);
    setRerunning(true);
    try {
      await api.post(`/actions/${params.actionId}/run`);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div>
      <h1>Execution History</h1>

      <button onClick={handleRerun} disabled={rerunning()}>
        Manually re-run using last known IP
      </button>

      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>

      <Show when={executions()} fallback={<p>Loading…</p>}>
        {(items) => (
          <table>
            <thead>
              <tr>
                <th>Triggered by</th>
                <th>IP values used</th>
                <th>Status</th>
                <th>Attempt</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <For each={items()}>
                {(execution) => (
                  <tr>
                    <td>{execution.triggeredBy}</td>
                    <td>
                      {execution.ipValuesUsed.ipv4 ?? "—"} / {execution.ipValuesUsed.ipv6 ?? "—"}
                    </td>
                    <td>{execution.status}</td>
                    <td>{execution.attempt}</td>
                    <td>{execution.error ?? "—"}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        )}
      </Show>
    </div>
  );
}
