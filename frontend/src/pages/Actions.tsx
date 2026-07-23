import { useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../services/api";

type AddressFamily = "ipv4" | "ipv6";

interface ActionSummary {
  actionId: string;
  ipClientId: string;
  type: string;
  addressFamilies: AddressFamily[];
  config: { providerCredentialId: string; zone: string; recordName: string } | null;
  status: "enabled" | "disabled" | "detached";
}

interface ProviderCredentialSummary {
  credentialId: string;
  provider: string;
  label: string;
}

export default function Actions() {
  const params = useParams<{ ipClientId: string }>();

  const [actions, { refetch: refetchActions }] = createResource(
    () => params.ipClientId,
    async (ipClientId) => {
      const res = await api.get<{ items: ActionSummary[] }>(`/ip-clients/${ipClientId}/actions`);
      return res.items;
    },
  );

  const [credentials] = createResource(async () => {
    const res = await api.get<{ items: ProviderCredentialSummary[] }>("/provider-credentials");
    return res.items;
  });

  const [zone, setZone] = createSignal("");
  const [recordName, setRecordName] = createSignal("");
  const [providerCredentialId, setProviderCredentialId] = createSignal("");
  const [ipv4, setIpv4] = createSignal(true);
  const [ipv6, setIpv6] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [editingActionId, setEditingActionId] = createSignal<string | null>(null);

  function startEdit(action: ActionSummary) {
    setEditingActionId(action.actionId);
    setProviderCredentialId(action.config?.providerCredentialId ?? "");
    setZone(action.config?.zone ?? "");
    setRecordName(action.config?.recordName ?? "");
    setIpv4(action.addressFamilies.includes("ipv4"));
    setIpv6(action.addressFamilies.includes("ipv6"));
  }

  function cancelEdit() {
    setEditingActionId(null);
    setProviderCredentialId("");
    setZone("");
    setRecordName("");
    setIpv4(true);
    setIpv6(false);
  }

  async function handleAttach(e: Event) {
    e.preventDefault();
    setError(null);
    const addressFamilies: AddressFamily[] = [
      ...(ipv4() ? (["ipv4"] as const) : []),
      ...(ipv6() ? (["ipv6"] as const) : []),
    ];
    const config = { providerCredentialId: providerCredentialId(), zone: zone(), recordName: recordName() };
    try {
      const editing = editingActionId();
      if (editing) {
        await api.put(`/actions/${editing}`, { addressFamilies, config });
      } else {
        await api.post(`/ip-clients/${params.ipClientId}/actions`, {
          type: "update_dns_record",
          addressFamilies,
          config,
        });
      }
      cancelEdit();
      await refetchActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggle(actionId: string, status: ActionSummary["status"]) {
    setError(null);
    try {
      await api.post(`/actions/${actionId}/${status === "enabled" ? "disable" : "enable"}`);
      await refetchActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDetach(actionId: string) {
    setError(null);
    if (!confirm("Detach this Action? This is irreversible.")) return;
    try {
      await api.delete(`/actions/${actionId}`);
      await refetchActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h1>Actions</h1>

      <form onSubmit={handleAttach}>
        <h2>{editingActionId() ? "Reconfigure Action" : "Attach a DNS-Update Action"}</h2>
        <label>
          Provider Credential
          <select value={providerCredentialId()} onChange={(e) => setProviderCredentialId(e.currentTarget.value)}>
            <option value="">Select a credential…</option>
            <For each={credentials()}>
              {(cred) => (
                <option value={cred.credentialId}>
                  {cred.label} ({cred.provider})
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          Hetzner Zone ID
          <input value={zone()} onInput={(e) => setZone(e.currentTarget.value)} />
        </label>
        <label>
          Record name
          <input value={recordName()} onInput={(e) => setRecordName(e.currentTarget.value)} />
        </label>
        <label>
          <input type="checkbox" checked={ipv4()} onChange={(e) => setIpv4(e.currentTarget.checked)} />
          IPv4 (A record)
        </label>
        <label>
          <input type="checkbox" checked={ipv6()} onChange={(e) => setIpv6(e.currentTarget.checked)} />
          IPv6 (AAAA record)
        </label>
        <button type="submit">{editingActionId() ? "Save changes" : "Attach Action"}</button>
        <Show when={editingActionId()}>
          <button type="button" onClick={cancelEdit}>
            Cancel
          </button>
        </Show>
      </form>

      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>

      <Show when={actions()} fallback={<p>Loading…</p>}>
        {(items) => (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Address families</th>
                <th>Zone</th>
                <th>Record</th>
                <th>Status</th>
                <th>History</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <For each={items()}>
                {(action) => (
                  <tr>
                    <td>{action.type}</td>
                    <td>{action.addressFamilies.join(", ")}</td>
                    <td>{action.config?.zone}</td>
                    <td>{action.config?.recordName}</td>
                    <td>{action.status}</td>
                    <td>
                      <a href={`/actions/${action.actionId}/executions`}>View executions</a>
                    </td>
                    <td>
                      <Show when={action.status !== "detached"}>
                        <button onClick={() => startEdit(action)}>Edit</button>
                        <button onClick={() => handleToggle(action.actionId, action.status)}>
                          {action.status === "enabled" ? "Disable" : "Enable"}
                        </button>
                        <button onClick={() => handleDetach(action.actionId)}>Detach</button>
                      </Show>
                    </td>
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
