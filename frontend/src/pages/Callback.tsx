import { useNavigate } from "@solidjs/router";
import { onMount } from "solid-js";
import { handleSignInCallback } from "../services/auth";

export default function Callback() {
  const navigate = useNavigate();

  onMount(async () => {
    try {
      await handleSignInCallback();
    } finally {
      navigate("/", { replace: true });
    }
  });

  return <p>Signing in…</p>;
}
