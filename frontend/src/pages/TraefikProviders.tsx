import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { CopyButton } from "~/components/feedback/CopyButton";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { EmptyState } from "~/components/layout/EmptyState";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { SetupResult } from "~/flows/traefik-provider-wizard/SetupResult";
import { TraefikProviderWizard } from "~/flows/traefik-provider-wizard/TraefikProviderWizard";
import {
  formatTime,
  NOTICE_LABEL,
  parseApiError,
  STATE_HINT,
  STATE_LABEL,
  type CreatedProvider,
  type TraefikProviderSummary,
} from "~/lib/traefik-providers";
import { api } from "~/services/api";

interface BlockingAction {
  actionId: string;
  ipClientId: string;
  group: string;
}

const STATE_CLASS: Record<TraefikProviderSummary["state"], string> = {
  connected: "text-green-600 dark:text-green-400",
  disconnected: "text-amber-600 dark:text-amber-400",
  stale: "text-destructive",
  never_connected: "text-muted-foreground",
};

async function fetchProviders(): Promise<TraefikProviderSummary[]> {
  const res = await api.get<{ items: TraefikProviderSummary[] }>("/traefik-providers");
  return res.items;
}

export default function TraefikProviders() {
  const [providers, { refetch }] = createResource(fetchProviders);
  const [creating, setCreating] = createSignal(false);
  const [created, setCreated] = createSignal<CreatedProvider | null>(null);
  const [newToken, setNewToken] = createSignal<{ providerName: string; value: string } | null>(null);
  const [error, setError] = createSignal<unknown>(null);
  const [blockedBy, setBlockedBy] = createSignal<BlockingAction[] | null>(null);

  // Connection state changes without any user action, so keep the list fresh while the page is open.
  const timer = setInterval(() => void refetch(), 15_000);
  onCleanup(() => clearInterval(timer));

  async function guarded(action: () => Promise<void>) {
    setError(null);
    setBlockedBy(null);
    try {
      await action();
      await refetch();
    } catch (err) {
      const usedBy = parseApiError<{ error?: string; usedBy?: BlockingAction[] }>(err, 409);
      if (usedBy?.error === "traefik_provider_in_use" && usedBy.usedBy) setBlockedBy(usedBy.usedBy);
      else setError(err);
    }
  }

  const handleCreated = (result: CreatedProvider) => {
    setCreating(false);
    setCreated(result);
  };

  const handleRename = (provider: TraefikProviderSummary) =>
    guarded(async () => {
      const name = prompt("New name for this provider", provider.name)?.trim();
      if (!name || name === provider.name) return;
      await api.patch<TraefikProviderSummary>(`/traefik-providers/${provider.providerId}`, { name });
    });

  const handleDelete = (provider: TraefikProviderSummary) =>
    guarded(async () => {
      if (!confirm(`Delete "${provider.name}"? Its agent will be disconnected and the address stops working.`)) return;
      await api.delete(`/traefik-providers/${provider.providerId}`);
    });

  const handleNewToken = (provider: TraefikProviderSummary) =>
    guarded(async () => {
      const token = await api.post<{ value: string }>(`/traefik-providers/${provider.providerId}/tokens`);
      setNewToken({ providerName: provider.name, value: token.value });
    });

  const handleRevoke = (provider: TraefikProviderSummary, tokenId: string, last4: string) =>
    guarded(async () => {
      if (!confirm(`Revoke the token ending in ${last4}? An agent using it is disconnected immediately.`)) return;
      await api.delete(`/traefik-providers/${provider.providerId}/tokens/${tokenId}`);
    });

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">Traefik providers</h1>
        <Button onClick={() => setCreating(true)}>Add a provider</Button>
      </div>

      <Show when={error()}>
        <ErrorMessage error={error()} />
      </Show>

      <Show when={blockedBy()}>
        {(actions) => (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              <p>This provider is still used by {actions().length} action(s) and can't be deleted yet:</p>
              <ul class="mt-2 list-disc pl-5">
                <For each={actions()}>
                  {(action) => (
                    <li>
                      group <code>{action.group}</code> —{" "}
                      <a href={`/ip-clients/${action.ipClientId}/actions`} class="underline">
                        view this device's actions
                      </a>
                    </li>
                  )}
                </For>
              </ul>
              <p class="mt-2">Remove those actions first, then try deleting the provider again.</p>
            </AlertDescription>
          </Alert>
        )}
      </Show>

      <Show when={created()}>
        {(result) => <SetupResult created={result()} onDone={() => {
              setCreated(null);
              void refetch();
            }} />}
      </Show>

      <Show when={providers()} fallback={<p class="text-muted-foreground">Loading…</p>}>
        {(items) => (
          <Show
            when={items().length > 0}
            fallback={
              <EmptyState
                message="You haven't added a Traefik provider yet. A provider connects one agent next to one Traefik, so FluxIP can keep its allow-lists and upstreams up to date."
                actionLabel="Add your first provider"
                onAction={() => setCreating(true)}
              />
            }
          >
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-2">
              <For each={items()}>
                {(provider) => (
                  <Card class="flex flex-col">
                    <CardHeader>
                      <CardTitle class="flex items-center justify-between gap-2 text-base">
                        <span>{provider.name}</span>
                        <span class={`text-xs font-medium ${STATE_CLASS[provider.state]}`} title={STATE_HINT[provider.state]}>
                          {STATE_LABEL[provider.state]}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent class="flex-1 space-y-3">
                      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        <dt class="text-muted-foreground">Last connected</dt>
                        <dd>{formatTime(provider.lastConnectedAt)}</dd>
                        <dt class="text-muted-foreground">Applied version</dt>
                        <dd>
                          {provider.appliedVersion ?? "—"}
                          <Show when={provider.publishedVersion !== null && provider.publishedVersion !== provider.appliedVersion}>
                            <span class="text-muted-foreground"> (latest {provider.publishedVersion})</span>
                          </Show>
                        </dd>
                        <dt class="text-muted-foreground">Agent</dt>
                        <dd>{provider.agentVersion ?? "—"}</dd>
                        <dt class="text-muted-foreground">Actions</dt>
                        <dd>{provider.actionCount}</dd>
                        <dt class="text-muted-foreground">Address</dt>
                        <dd class="flex items-center gap-2">
                          <code class="break-all text-xs">{provider.agentAddress}</code>
                          <CopyButton text={provider.agentAddress} />
                        </dd>
                      </dl>

                      <Show when={provider.lastError}>
                        {(e) => (
                          <Alert variant="destructive" role="alert">
                            <AlertDescription>
                              The agent could not apply version {e().version}: {e().reason}
                            </AlertDescription>
                          </Alert>
                        )}
                      </Show>
                      <Show when={provider.lastPublishError}>
                        {(e) => (
                          <Alert variant="destructive" role="alert">
                            <AlertDescription>
                              {e().reason === "too_large"
                                ? "The current data is too large to send to the agent. Remove devices from this provider."
                                : "FluxIP could not prepare the latest data for this agent."}
                            </AlertDescription>
                          </Alert>
                        )}
                      </Show>
                      <For each={provider.notices}>
                        {(notice) => <p class="text-sm text-amber-600 dark:text-amber-400">{NOTICE_LABEL[notice] ?? notice}</p>}
                      </For>

                      <div class="space-y-1">
                        <p class="text-sm font-medium">Tokens</p>
                        <ul class="space-y-1 text-sm">
                          <For each={provider.tokens}>
                            {(token) => (
                              <li class="flex items-center justify-between gap-2">
                                <span class={token.status === "revoked" ? "text-muted-foreground line-through" : ""}>
                                  fxt_…{token.last4} <span class="text-xs text-muted-foreground">issued {formatTime(token.issuedAt)}</span>
                                </span>
                                <Show
                                  when={token.status === "valid"}
                                  fallback={<span class="text-xs text-muted-foreground">revoked</span>}
                                >
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleRevoke(provider, token.tokenId, token.last4)}
                                  >
                                    Revoke
                                  </Button>
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    </CardContent>
                    <CardFooter class="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void handleNewToken(provider)}>
                        New token
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void handleRename(provider)}>
                        Rename
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void handleDelete(provider)}>
                        Delete
                      </Button>
                    </CardFooter>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>

      <Dialog open={creating()} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle class="sr-only">Add a Traefik provider</DialogTitle>
          </DialogHeader>
          <Show when={creating()}>
            <TraefikProviderWizard onCreated={(result) => void handleCreated(result)} onCancel={() => setCreating(false)} />
          </Show>
        </DialogContent>
      </Dialog>

      <Dialog open={newToken() !== null} onOpenChange={(open) => !open && setNewToken(null)}>
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle>New token for {newToken()?.providerName}</DialogTitle>
          </DialogHeader>
          <Show when={newToken()}>
            {(token) => (
              <div class="space-y-3 text-sm">
                <p>Both the old and the new token work until you revoke the old one. This token is shown only once.</p>
                <div class="flex items-center gap-2">
                  <code class="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{token().value}</code>
                  <CopyButton text={token().value} />
                </div>
                <div class="flex justify-end">
                  <Button onClick={() => setNewToken(null)}>I have saved it</Button>
                </div>
              </div>
            )}
          </Show>
        </DialogContent>
      </Dialog>
    </div>
  );
}
