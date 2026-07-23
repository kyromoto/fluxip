import LogtoClient from "@logto/browser";
import { createSignal } from "solid-js";

const endpoint = import.meta.env.VITE_LOGTO_ENDPOINT;
const appId = import.meta.env.VITE_LOGTO_APP_ID;
const apiResource = import.meta.env.VITE_LOGTO_API_RESOURCE;

if (!endpoint || !appId || !apiResource) {
  console.warn(
    "VITE_LOGTO_ENDPOINT / VITE_LOGTO_APP_ID / VITE_LOGTO_API_RESOURCE are not set (see frontend/.env.example) — sign-in will fail.",
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

const [isAuthenticated, setIsAuthenticated] = createSignal(false);
export { isAuthenticated };

/** Re-reads auth state from the Logto client's own storage (call on app start and after callback). */
export async function refreshAuthState(): Promise<void> {
  setIsAuthenticated(await logtoClient.isAuthenticated());
}

function callbackUri(): string {
  return new URL("/callback", window.location.origin).toString();
}

export async function signIn(): Promise<void> {
  await logtoClient.signIn(callbackUri());
}

export async function signOut(): Promise<void> {
  await logtoClient.signOut(window.location.origin);
  setIsAuthenticated(false);
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
