# Contract: `window.__ENV__`

The interface frontend application code depends on to read deployment-specific configuration (FR-003). This is the boundary between the generated `config.js` artifact and every consumer in `frontend/src`.

## Shape

```ts
interface WindowEnv {
  LOGTO_ENDPOINT?: string;
  LOGTO_APP_ID?: string;
  LOGTO_API_RESOURCE?: string;
  BACKEND_URL?: string;
}

declare global {
  interface Window {
    __ENV__?: WindowEnv;
  }
}
```

- Every key is optional at the type level because `window.__ENV__` may be the empty placeholder (`frontend/public/config.js`, data-model.md "Generated Config Artifact") in local dev, or a key's value may be an empty string if an operator omitted the corresponding `FRONTEND_*` env var (data-model.md "Runtime Config Warning").
- Values, when present, are always strings — no nested objects, arrays, or non-string types are part of this contract.
- `window.__ENV__` itself is always a defined object by the time application code runs, in both dev (placeholder) and prod (generated); code MUST NOT assume it is `undefined`, but MUST still handle any individual key being absent or empty.

## Consumer contract

Application code MUST NOT read `window.__ENV__` directly. It MUST go through `frontend/src/config.ts`, which is responsible for the `window.__ENV__` → `import.meta.env.VITE_*` fallback (research.md §3) and returns a plain value (string, possibly empty), not the raw `WindowEnv` object.

```ts
// frontend/src/config.ts (contract, not full implementation)
export function getLogtoEndpoint(): string;
export function getLogtoAppId(): string;
export function getLogtoApiResource(): string;
export function getBackendUrl(): string;
```

Each function:
1. Returns `window.__ENV__.<KEY>` if it is a non-empty string.
2. Otherwise returns the corresponding `import.meta.env.VITE_*` value (dev fallback), or `""` if that is also unset.
3. Never throws — an unresolved value is always an empty string, never `undefined`, `null`, or an exception (consistent with data-model.md's "never blocking" invariant).

## Producer contract (who may write `window.__ENV__`)

Only two writers exist, and application code must never assume anything about *how* the value got there beyond this contract:

1. `frontend/public/config.js` (checked into source, copied verbatim by `vite build`) — sets `window.__ENV__ = {};`.
2. The Docker entrypoint's generated `frontend/dist/config.js` (overwrites the above at every container start) — sets `window.__ENV__ = <JSON.stringify of the Deployment Configuration>;`.

Both are loaded via `<script src="/config.js?v=...">` in `index.html`, before the main application bundle's `<script type="module">` (FR-002) — so by the time any application module executes, `window.__ENV__` is already whatever the current writer set it to.
