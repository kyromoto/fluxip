import { createResource, createSignal, For, Show } from "solid-js";
import { api, ApiError } from "../services/api";

interface NotificationChannelInfo {
  type: "email";
  addresses: string[];
}

interface IpClientSummary {
  ipClientId: string;
  label: string;
  notificationPreference: "off" | "failures_only" | "all";
}

async function fetchChannel(): Promise<NotificationChannelInfo | null> {
  try {
    return await api.get<NotificationChannelInfo>("/notification-channel");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function fetchIpClients(): Promise<IpClientSummary[]> {
  const res = await api.get<{ items: IpClientSummary[] }>("/ip-clients");
  return res.items;
}

export default function NotificationSettings() {
  const [channel, { refetch: refetchChannel }] = createResource(fetchChannel);
  const [ipClients, { refetch: refetchIpClients }] = createResource(fetchIpClients);
  const [addresses, setAddresses] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  function addressList(): string[] {
    return addresses()
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    setError(null);
    try {
      if (channel()) {
        await api.put("/notification-channel", { addresses: addressList() });
      } else {
        await api.post("/notification-channel", { type: "email", addresses: addressList() });
      }
      setAddresses("");
      await refetchChannel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await api.delete("/notification-channel");
      await refetchChannel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePreferenceChange(ipClientId: string, preference: IpClientSummary["notificationPreference"]) {
    setError(null);
    try {
      await api.put(`/ip-clients/${ipClientId}/notification-preference`, { preference });
      await refetchIpClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h1>Notification Settings</h1>

      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>

      <section>
        <h2>Email channel</h2>
        <Show when={channel()}>
          {(info) => (
            <div>
              <p>Currently notifying: {info().addresses.join(", ")}</p>
              <button onClick={handleDelete}>Remove channel</button>
            </div>
          )}
        </Show>
        <form onSubmit={handleSave}>
          <label>
            Email address(es), comma-separated
            <input value={addresses()} onInput={(e) => setAddresses(e.currentTarget.value)} placeholder="you@example.com" />
          </label>
          <button type="submit">{channel() ? "Update addresses" : "Register channel"}</button>
        </form>
      </section>

      <section>
        <h2>Per-IP-Client preference</h2>
        <Show when={ipClients()} fallback={<p>Loading…</p>}>
          {(items) => (
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Notify on</th>
                </tr>
              </thead>
              <tbody>
                <For each={items()}>
                  {(client) => (
                    <tr>
                      <td>{client.label}</td>
                      <td>
                        <select
                          value={client.notificationPreference}
                          onChange={(e) =>
                            handlePreferenceChange(
                              client.ipClientId,
                              e.currentTarget.value as IpClientSummary["notificationPreference"],
                            )
                          }
                        >
                          <option value="off">Off</option>
                          <option value="failures_only">Failures only</option>
                          <option value="all">All updates</option>
                        </select>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          )}
        </Show>
      </section>
    </div>
  );
}
