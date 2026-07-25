import LogtoClient from "@logto/browser";
import { createSignal } from "solid-js";
import { getLogtoApiResource, getLogtoAppId, getLogtoEndpoint } from "~/config";

const endpoint = getLogtoEndpoint();
const appId = getLogtoAppId();
const apiResource = getLogtoApiResource();

if (!endpoint || !appId || !apiResource) {
  console.warn(
    "Logto endpoint/app ID/API resource are not set (window.__ENV__ in production, VITE_LOGTO_* in frontend/.env for dev) — sign-in will fail.",
  );
}

export const logtoClient = new LogtoClient({
  endpoint: endpoint ?? "",
  appId: appId ?? "",
  // The SDK's default reserved scopes are openid + offline_access + profile.
  // This backend only ever reads `sub` (as tenant_id) and an optional `roles`
  // claim — never `profile` — and this Logto instance doesn't allow the
  // `profile` scope for this application, so request only what's needed.
  includeReservedScopes: false,
  scopes: ["openid", "offline_access"],
  // Without a resource indicator, Logto issues an opaque access token that
  // the backend's JWT/JWKS verification (research.md §7) can't parse at all.
  // Requesting this API resource makes Logto issue a signed JWT instead.
  resources: apiResource ? [apiResource] : undefined,
});

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/** "loading" until the first `refreshAuthState()` call resolves — lets callers avoid a flash of the wrong UI. */
const [authStatus, setAuthStatus] = createSignal<AuthStatus>("loading");
export { authStatus };

/** Convenience boolean derived from `authStatus` — never true while still "loading". */
export const isAuthenticated = () => authStatus() === "authenticated";

/** Re-reads auth state from the Logto client's own storage (call on app start and after callback). */
export async function refreshAuthState(): Promise<void> {
  setAuthStatus((await logtoClient.isAuthenticated()) ? "authenticated" : "unauthenticated");
}

function callbackUri(): string {
  return new URL("/callback", window.location.origin).toString();
}

export async function signIn(): Promise<void> {
  await logtoClient.signIn(callbackUri());
}

export async function signOut(): Promise<void> {
  await logtoClient.signOut(window.location.origin);
  setAuthStatus("unauthenticated");
}

export async function handleSignInCallback(): Promise<void> {
  await logtoClient.handleSignInCallback(window.location.href);
  await refreshAuthState();
}

/** Used by services/api.ts — null when signed out, never throws. */
export async function getAccessToken(): Promise<string | null> {
  try {
    return await logtoClient.getAccessToken(apiResource);
  } catch {
    return null;
  }
}
