// Prefers window.__ENV__ (set by docker-entrypoint.sh at container start —
// specs/006-frontend-runtime-config) and falls back to the build-time
// VITE_* value, which is what local dev (`vite dev`) always resolves to
// since it never generates window.__ENV__ (research.md §3, FR-011).
function resolveValue(runtimeValue: string | undefined, buildTimeValue: string | undefined): string {
  if (runtimeValue) return runtimeValue;
  if (buildTimeValue) return buildTimeValue;
  return "";
}

export function getLogtoEndpoint(): string {
  return resolveValue(window.__ENV__?.LOGTO_ENDPOINT, import.meta.env.VITE_LOGTO_ENDPOINT);
}

export function getLogtoAppId(): string {
  return resolveValue(window.__ENV__?.LOGTO_APP_ID, import.meta.env.VITE_LOGTO_APP_ID);
}

export function getLogtoApiResource(): string {
  return resolveValue(window.__ENV__?.LOGTO_API_RESOURCE, import.meta.env.VITE_LOGTO_API_RESOURCE);
}

export function getBackendUrl(): string {
  return resolveValue(window.__ENV__?.BACKEND_URL, import.meta.env.VITE_BACKEND_URL);
}
