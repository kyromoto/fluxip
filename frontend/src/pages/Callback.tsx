import { useNavigate } from "@solidjs/router";
import { onMount } from "solid-js";
import { handleSignInCallback } from "~/services/auth";

export default function Callback() {
  const navigate = useNavigate();

  onMount(async () => {
    try {
      await handleSignInCallback();
    } finally {
      navigate("/", { replace: true });
    }
  });

  return (
    <div class="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div class="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      <p class="text-muted-foreground">Signing in…</p>
    </div>
  );
}
