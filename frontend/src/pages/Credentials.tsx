import { createResource, createSignal, For, Show } from "solid-js";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { EmptyState } from "~/components/layout/EmptyState";
import { CredentialFormDialog } from "~/components/credentials/CredentialFormDialog";
import { credentialTypeLabel } from "~/lib/credential-types";
import { api, ApiError } from "~/services/api";

interface CredentialSummary {
  credentialId: string;
  provider: string;
  label: string;
  secretLast4: string;
}

interface BlockingAction {
  actionId: string;
  ipClientId: string;
  zone: string;
  recordName: string;
}

async function fetchCredentials(): Promise<CredentialSummary[]> {
  const res = await api.get<{ items: CredentialSummary[] }>("/provider-credentials");
  return res.items;
}

/** Parses the 409 `credential_in_use` body (contracts/provider-credentials-api.md); null for any other error shape. */
function parseBlockingActions(err: unknown): BlockingAction[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  try {
    const body = JSON.parse(err.message) as { error?: string; usedBy?: BlockingAction[] };
    return body.error === "credential_in_use" && Array.isArray(body.usedBy) ? body.usedBy : null;
  } catch {
    return null;
  }
}

export default function Credentials() {
  const [credentials, { refetch }] = createResource(fetchCredentials);
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);
  const [blockedBy, setBlockedBy] = createSignal<BlockingAction[] | null>(null);

  function openDialog() {
    setError(null);
    setBlockedBy(null);
    setDialogOpen(true);
  }

  async function handleCreated() {
    setDialogOpen(false);
    await refetch();
  }

  async function handleDelete(credentialId: string) {
    setError(null);
    setBlockedBy(null);
    if (!confirm("Delete this credential? This can't be undone.")) return;
    try {
      await api.delete(`/provider-credentials/${credentialId}`);
      await refetch();
    } catch (err) {
      const usedBy = parseBlockingActions(err);
      if (usedBy) {
        setBlockedBy(usedBy);
      } else {
        setError(err);
      }
    }
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">Credentials</h1>
        <Button onClick={openDialog}>Add credential</Button>
      </div>

      <Show when={error()}>
        <ErrorMessage error={error()} />
      </Show>

      <Show when={blockedBy()}>
        {(actions) => (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              <p>This credential is still used by {actions().length} action(s) and can't be deleted yet:</p>
              <ul class="mt-2 list-disc pl-5">
                <For each={actions()}>
                  {(action) => (
                    <li>
                      {action.recordName} ({action.zone}) —{" "}
                      <a href={`/ip-clients/${action.ipClientId}/actions`} class="underline">
                        view this device's actions
                      </a>
                    </li>
                  )}
                </For>
              </ul>
              <p class="mt-2">Remove or reassign those actions first, then try deleting it again.</p>
            </AlertDescription>
          </Alert>
        )}
      </Show>

      <Show when={credentials()} fallback={<p class="text-muted-foreground">Loading…</p>}>
        {(items) => (
          <Show
            when={items().length > 0}
            fallback={
              <EmptyState
                message="You haven't added any credentials yet. Store an API token here once, then reuse it across any number of actions."
                actionLabel="Add your first credential"
                onAction={openDialog}
              />
            }
          >
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <For each={items()}>
                {(credential) => (
                  <Card class="flex flex-col">
                    <CardHeader>
                      <CardTitle class="text-base">{credential.label}</CardTitle>
                      <p class="text-xs text-muted-foreground">{credentialTypeLabel(credential.provider)}</p>
                    </CardHeader>
                    <CardContent class="flex-1">
                      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        <dt class="text-muted-foreground">Token</dt>
                        <dd class="font-mono text-xs">••••{credential.secretLast4}</dd>
                      </dl>
                    </CardContent>
                    <CardFooter>
                      <Button size="sm" variant="destructive" onClick={() => handleDelete(credential.credentialId)}>
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

      <CredentialFormDialog open={dialogOpen()} onOpenChange={setDialogOpen} onCreated={() => void handleCreated()} />
    </div>
  );
}
