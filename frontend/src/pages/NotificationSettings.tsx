import { createResource, createSignal, For, Show } from "solid-js";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { EmptyState } from "~/components/layout/EmptyState";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextField, TextFieldDescription, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { api, ApiError } from "~/services/api";

interface NotificationChannelInfo {
  type: "email";
  addresses: string[];
}

interface IpClientSummary {
  ipClientId: string;
  label: string;
  notificationPreference: "off" | "failures_only" | "all";
}

const PREFERENCE_OPTIONS: { value: IpClientSummary["notificationPreference"]; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "failures_only", label: "Failures only" },
  { value: "all", label: "All updates" },
];

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
  const [error, setError] = createSignal<unknown>(null);

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
      setError(err);
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await api.delete("/notification-channel");
      await refetchChannel();
    } catch (err) {
      setError(err);
    }
  }

  async function handlePreferenceChange(ipClientId: string, preference: IpClientSummary["notificationPreference"]) {
    setError(null);
    try {
      await api.put(`/ip-clients/${ipClientId}/notification-preference`, { preference });
      await refetchIpClients();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div class="space-y-6">
      <h1 class="text-2xl font-semibold tracking-tight">Notifications</h1>

      <Show when={error()}>
        <ErrorMessage error={error()} />
      </Show>

      <Card>
        <CardHeader>
          <CardTitle>Email address</CardTitle>
          <CardDescription>Where we'll send updates about your devices' automations.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <Show when={channel()}>
            {(info) => (
              <div class="flex items-center justify-between gap-4 rounded-md border p-3 text-sm">
                <span>{info().addresses.join(", ")}</span>
                <Button size="sm" variant="outline" onClick={() => void handleDelete()}>
                  Remove
                </Button>
              </div>
            )}
          </Show>
          <form onSubmit={handleSave} class="space-y-4">
            <TextField value={addresses()} onChange={setAddresses}>
              <TextFieldLabel>Email address(es)</TextFieldLabel>
              <TextFieldInput placeholder="you@example.com" />
              <TextFieldDescription>Separate multiple addresses with commas.</TextFieldDescription>
            </TextField>
            <Button type="submit">{channel() ? "Update addresses" : "Save"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-device preference</CardTitle>
          <CardDescription>Choose when each device should notify you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Show when={ipClients()} fallback={<p class="text-muted-foreground">Loading…</p>}>
            {(items) => (
              <Show
                when={items().length > 0}
                fallback={
                  <EmptyState
                    message="You haven't added any devices yet."
                    actionLabel="Go to Devices"
                    onAction={() => (window.location.href = "/ip-clients")}
                  />
                }
              >
                <ul class="space-y-3">
                  <For each={items()}>
                    {(client) => (
                      <li class="flex items-center justify-between gap-4">
                        <span class="text-sm font-medium">{client.label}</span>
                        <Select<{ value: IpClientSummary["notificationPreference"]; label: string }>
                          options={PREFERENCE_OPTIONS}
                          optionValue="value"
                          optionTextValue="label"
                          value={PREFERENCE_OPTIONS.find((o) => o.value === client.notificationPreference) ?? null}
                          onChange={(opt) => opt && handlePreferenceChange(client.ipClientId, opt.value)}
                          itemComponent={(itemProps) => (
                            <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
                          )}
                        >
                          <SelectTrigger class="w-40">
                            <SelectValue<{ value: string; label: string }>>
                              {(state) => state.selectedOption()?.label}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent />
                        </Select>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}
