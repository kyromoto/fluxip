import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../services/api";

interface IpClientSummary {
  ipClientId: string;
  label: string;
  status: "enabled" | "disabled" | "decommissioned";
  lastKnownIPv4: string | null;
  lastKnownIPv6: string | null;
  notificationPreference: "off" | "failures_only" | "all";
}

interface RegisterResponse {
  ipClientId: string;
  label?: string;
  reportingCredential: { username: string; password: string };
}

async function fetchIpClients(): Promise<IpClientSummary[]> {
  const res = await api.get<{ items: IpClientSummary[] }>("/ip-clients");
  return res.items;
}

export default function IpClients() {
  const [ipClients, { refetch }] = createResource(fetchIpClients);
  const [label, setLabel] = createSignal("");
  const [newCredential, setNewCredential] = createSignal<RegisterResponse | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function handleRegister(e: Event) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<RegisterResponse>("/ip-clients", { label: label() });
      setNewCredential(result);
      setLabel("");
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggle(ipClientId: string, status: IpClientSummary["status"]) {
    setError(null);
    try {
      await api.post(`/ip-clients/${ipClientId}/${status === "enabled" ? "disable" : "enable"}`);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRotate(ipClientId: string) {
    setError(null);
    try {
      const result = await api.post<RegisterResponse>(`/ip-clients/${ipClientId}/rotate-credential`);
      setNewCredential(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDecommission(ipClientId: string) {
    setError(null);
    if (!confirm("Decommission this IP Client? This is irreversible.")) return;
    try {
      await api.delete(`/ip-clients/${ipClientId}`);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h1>IP Clients</h1>

      <form onSubmit={handleRegister}>
        <label>
          Label
          <input value={label()} onInput={(e) => setLabel(e.currentTarget.value)} placeholder="e.g. Home FritzBox" />
        </label>
        <button type="submit">Register new IP Client</button>
      </form>

      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>

      <Show when={newCredential()}>
        {(cred) => (
          <div role="alert">
            <p>
              Save these now — the password is shown only once. Configure your router's DynDNS client
              with these values:
            </p>
            <dl>
              <dt>Update URL</dt>
              <dd>/nic/update?hostname=fluxip&amp;myip=&lt;ipaddr&gt;</dd>
              <dt>Username</dt>
              <dd>{cred().reportingCredential.username}</dd>
              <dt>Password</dt>
              <dd>{cred().reportingCredential.password}</dd>
            </dl>
            <button onClick={() => setNewCredential(null)}>Done, I've saved it</button>
          </div>
        )}
      </Show>

      <Show when={ipClients()} fallback={<p>Loading…</p>}>
        {(items) => (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Status</th>
                <th>Last known IPv4</th>
                <th>Last known IPv6</th>
                <th>Notifications</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <For each={items()}>
                {(client) => (
                  <tr>
                    <td>
                      <a href={`/ip-clients/${client.ipClientId}/actions`}>{client.label}</a>
                    </td>
                    <td>{client.status}</td>
                    <td>{client.lastKnownIPv4 ?? "—"}</td>
                    <td>{client.lastKnownIPv6 ?? "—"}</td>
                    <td>{client.notificationPreference}</td>
                    <td>
                      <Show when={client.status !== "decommissioned"}>
                        <button onClick={() => handleToggle(client.ipClientId, client.status)}>
                          {client.status === "enabled" ? "Disable" : "Enable"}
                        </button>
                        <button onClick={() => handleRotate(client.ipClientId)}>Rotate credential</button>
                        <button onClick={() => handleDecommission(client.ipClientId)}>Decommission</button>
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
