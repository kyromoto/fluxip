import { createResource, createSignal, Show } from "solid-js";
import { api } from "../services/api";

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
  const [passwordError, setPasswordError] = createSignal<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);

  async function handlePasswordChange(e: Event) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      await api.put("/account/password", { newPassword: newPassword() });
      setNewPassword("");
      setPasswordSuccess(true);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteAccount() {
    setDeleteError(null);
    if (!confirm("Delete your account? This is immediate and permanent — all your data will be erased.")) return;
    try {
      await api.delete("/account");
      window.location.href = "/";
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h1>Account Settings</h1>

      <Show when={account()}>
        {(info) => (
          <dl>
            <dt>Account ID</dt>
            <dd>{info().accountId}</dd>
            <dt>IP Client limit</dt>
            <dd>{info().deviceLimit}</dd>
            <dt>Status</dt>
            <dd>{info().status}</dd>
          </dl>
        )}
      </Show>

      <section>
        <h2>Change password</h2>
        <form onSubmit={handlePasswordChange}>
          <label>
            New password
            <input
              type="password"
              value={newPassword()}
              onInput={(e) => setNewPassword(e.currentTarget.value)}
              minLength={8}
              required
            />
          </label>
          <button type="submit">Change password</button>
        </form>
        <Show when={passwordError()}>
          <p role="alert">{passwordError()}</p>
        </Show>
        <Show when={passwordSuccess()}>
          <p>Password changed successfully.</p>
        </Show>
      </section>

      <section>
        <h2>Delete account</h2>
        <p>This immediately and permanently erases your account and all its data. There is no undo.</p>
        <button onClick={handleDeleteAccount}>Delete my account</button>
        <Show when={deleteError()}>
          <p role="alert">{deleteError()}</p>
        </Show>
      </section>
    </div>
  );
}
