import { createResource, createSignal, Show } from "solid-js";
import { ErrorMessage } from "~/components/feedback/ErrorMessage";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { TextField, TextFieldInput, TextFieldLabel } from "~/components/ui/text-field";
import { api } from "~/services/api";

interface AccountInfo {
  accountId: string;
  deviceLimit: number;
  status: "active" | "closed";
}

async function fetchAccount(): Promise<AccountInfo> {
  return api.get<AccountInfo>("/account");
}

export default function Account() {
  const [account] = createResource(fetchAccount);
  const [newPassword, setNewPassword] = createSignal("");
  const [passwordError, setPasswordError] = createSignal<unknown>(null);
  const [passwordSuccess, setPasswordSuccess] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<unknown>(null);

  async function handlePasswordChange(e: Event) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      await api.put("/account/password", { newPassword: newPassword() });
      setNewPassword("");
      setPasswordSuccess(true);
    } catch (err) {
      setPasswordError(err);
    }
  }

  async function handleDeleteAccount() {
    setDeleteError(null);
    if (!confirm("Delete your account? This is immediate and permanent — all your data will be erased.")) return;
    try {
      await api.delete("/account");
      window.location.href = "/";
    } catch (err) {
      setDeleteError(err);
    }
  }

  return (
    <div class="space-y-6">
      <h1 class="text-2xl font-semibold tracking-tight">Account</h1>

      <Show when={account()}>
        {(info) => (
          <Card>
            <CardContent class="pt-6">
              <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-muted-foreground">Account ID</dt>
                <dd class="font-mono">{info().accountId}</dd>
                <dt class="text-muted-foreground">Device limit</dt>
                <dd>{info().deviceLimit}</dd>
                <dt class="text-muted-foreground">Status</dt>
                <dd>{info().status === "active" ? "Active" : "Closed"}</dd>
              </dl>
            </CardContent>
          </Card>
        )}
      </Show>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <form onSubmit={handlePasswordChange}>
          <CardContent class="space-y-4">
            <TextField value={newPassword()} onChange={setNewPassword}>
              <TextFieldLabel>New password</TextFieldLabel>
              <TextFieldInput type="password" minLength={8} required />
            </TextField>
            <Show when={passwordError()}>
              <ErrorMessage error={passwordError()} />
            </Show>
            <Show when={passwordSuccess()}>
              <p class="text-sm text-muted-foreground">Password changed successfully.</p>
            </Show>
          </CardContent>
          <CardFooter>
            <Button type="submit">Change password</Button>
          </CardFooter>
        </form>
      </Card>

      <Card class="border-destructive/50">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            This immediately and permanently erases your account and all its data. There is no
            undo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Show when={deleteError()}>
            <ErrorMessage error={deleteError()} />
          </Show>
        </CardContent>
        <CardFooter>
          <Button variant="destructive" onClick={() => void handleDeleteAccount()}>
            Delete my account
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
