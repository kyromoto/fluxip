# Contract: Logging Topology (categories, sinks, and the guarantee that they never mix)

This is not an HTTP API contract — this feature adds no endpoint. It's the contract other code (and future features) can rely on: which LogTape categories exist, which sink each is bound to, and the invariants that make FR-008's separation a structural guarantee rather than a convention.

## Category → Sink bindings

| Category | Sink | Wrapped with |
|---|---|---|
| `["fluxip", "app"]` (and every child, e.g. `["fluxip","app","trigger"]`) | `console` (`getConsoleSink()`) | `redactByField(...)` |
| `["fluxip", "access"]` | `access-file` (`getRotatingFileSink(ACCESS_LOG_FILE_PATH, { maxSize, maxFiles })`) | `redactByField(...)` |

**Invariant**: no sink is ever listed for both categories, and no category is ever a prefix/ancestor of the other. A future contributor adding a new Application Log call site under `["fluxip", "app", ...]` cannot accidentally write to the Access Log's file, and `honoLogger()` is the *only* thing ever configured to log under `["fluxip", "access"]`.

## `getAppLogger(category)` — the only way application code logs

```ts
// backend/src/observability/app-logger.ts
export function getAppLogger(category: string[]): Logger; // category is appended under ["fluxip", "app", ...category]
export function withOperation<T>(correlationId: string, fn: () => T): T; // wraps LogTape's withContext({ correlationId }, fn)
```

- Call sites never call `getLogger()` directly — always through `getAppLogger(...)`, which hard-codes the `["fluxip", "app"]` prefix so it's structurally impossible to log application activity under the Access Log's category by mistake.
- `withOperation(correlationId, fn)` must be called once per operation, as early as possible in that operation's async context (the debounce-worker settle handler, the action-execution-worker's job handler, the manual-run route handler) — every `getAppLogger(...).info(...)` call made inside `fn` automatically carries `correlationId` via LogTape's implicit context, with no need to pass it explicitly to each call.

## Correlation ID contract (FR-004, resolved by clarification)

- **Value**: always the existing `causationEventId` — never a newly-invented identifier scheme. See `data-model.md`'s emission-point table for exactly which value at each call site.
- **Presence**: every Application Log entry produced from inside a `withOperation(...)` scope carries it; entries logged outside any such scope (the raw "trigger report received" entry) do not, and that absence is expected, not a bug (research.md §3).
- **Uniqueness across operations**: a manual re-run's `causationEventId` is always freshly generated at request time (`action-run.ts`) and is never equal to the original operation's `causationEventId`, even when retrying that same original operation's failure.

## Access Log middleware contract (FR-006/FR-007)

```ts
app.use(honoLogger({
  category: ["fluxip", "access"],
  context: true,               // establishes requestId propagation for any app-log entries nested inside the same request (not required by this feature, but harmless/available)
  format: "structured-combined",
  enrich: (c) => ({ sourceIp: resolveSourceIp(c) }), // research.md §7
}));
```

- Mounted at the very top of the outermost Hono app (`app`, not the OIDC-protected `api` sub-router) — before the trigger route, before `api`, before `admin` — so every request produces an entry regardless of whether it's public, authenticated, or rejected before reaching any route handler (FR-007).
- `resolveSourceIp(c)` tries `getConnInfo(c).remote.address` first (same helper `trigger.ts` already uses), falling back to the `X-Forwarded-For` request header.

## Secret redaction contract (FR-009)

Both sinks in the table above are wrapped with:

```ts
redactByField(sink, [...DEFAULT_REDACT_FIELDS, /authorization/i, /credential/i])
```

This is a second layer, not the only one — call sites themselves never pass a decrypted Provider Credential secret, a Trigger Device reporting credential, or a raw `Authorization` header value as a log argument or property in the first place.
