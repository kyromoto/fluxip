import { useParams } from "@solidjs/router";
import { createResource, createSignal, Show } from "solid-js";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ReviewCredentialStep } from "~/flows/device-wizard/steps/ReviewCredentialStep";
import { api } from "~/services/api";

interface IpClientSummary {
  ipClientId: string;
  label: string;
  status: "enabled" | "disabled" | "decommissioned";
}

const STATUS_LABEL: Record<IpClientSummary["status"], string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  decommissioned: "Decommissioned",
};

export default function DeviceSettings() {
  const params = useParams<{ ipClientId: string }>();

  const [device, { refetch }] = createResource(
    () => params.ipClientId,
    (ipClientId) => api.get<IpClientSummary>(`/ip-clients/${ipClientId}`),
  );

  const [rotatedCredential, setRotatedCredential] = createSignal<{ username: string; password: string } | null>(
    null,
  );
  const [error, setError] = createSignal<unknown>(null);

  async function handleToggle(status: IpClientSummary["status"]) {
    setError(null);
    try {
      await api.post(`/ip-clients/${params.ipClientId}/${status === "enabled" ? "disable" : "enable"}`);
      await refetch();
    } catch (err) {
      setError(err);
    }
  }

  async function handleRotate() {
    setError(null);
    if (!confirm("Rotate the reporting credential? The device stops reporting until it uses the new one.")) return;
    try {
      const result = await api.post<{ reportingCredential: { username: string; password: string } }>(
        `/ip-clients/${params.ipClientId}/rotate-credential`,
      );
      setRotatedCredential(result.reportingCredential);
    } catch (err) {
      setError(err);
    }
  }

  async function handleDecommission() {
    setError(null);
    if (!confirm("Decommission this device? This is irreversible.")) return;
    try {
      await api.delete(`/ip-clients/${params.ipClientId}`);
      await refetch();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div class="space-y-6">
      <h1 class="text-2xl font-semibold tracking-tight">{device()?.label ?? "Device"} — settings</h1>

      <Show when={device()}>
        {(client) => (
          <>
            <Card>
              <CardContent class="pt-6">
                <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt class="text-muted-foreground">Status</dt>
                  <dd>{STATUS_LABEL[client().status]}</dd>
                </dl>
              </CardContent>
            </Card>

            <Show when={error()}>
              <ErrorMessage error={error()} />
            </Show>

            <Show
              when={client().status !== "decommissioned"}
              fallback={
                <Card class="border-dashed">
                  <CardContent class="py-10 text-center text-muted-foreground">
                    This device has been decommissioned. No further changes are possible.
                  </CardContent>
                </Card>
              }
            >
              <Card>
                <CardHeader>
                  <CardTitle>{client().status === "enabled" ? "Disable device" : "Enable device"}</CardTitle>
                  <CardDescription>
                    {client().status === "enabled"
                      ? "A disabled device's reported address changes are ignored and none of its actions run."
                      : "Resume processing this device's reported address changes and run its actions again."}
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button variant="outline" onClick={() => void handleToggle(client().status)}>
                    {client().status === "enabled" ? "Disable device" : "Enable device"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Rotate credential</CardTitle>
                  <CardDescription>
                    Issues a new reporting credential. The current one stops working, so update the device with the
                    new one.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button variant="outline" onClick={() => void handleRotate()}>
                    Rotate credential
                  </Button>
                </CardFooter>
              </Card>

              <Card class="border-destructive/50">
                <CardHeader>
                  <CardTitle>Decommission device</CardTitle>
                  <CardDescription>
                    Permanently retires this device. This cannot be undone.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button variant="destructive" onClick={() => void handleDecommission()}>
                    Decommission device
                  </Button>
                </CardFooter>
              </Card>
            </Show>
          </>
        )}
      </Show>

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
