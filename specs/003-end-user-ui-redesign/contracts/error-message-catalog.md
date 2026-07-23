# UI Contract: Plain-Language Error Message Catalog

Governs `frontend/src/lib/errors.ts` and `ErrorMessage.tsx` (FR-013/014/015). Every surface in the redesigned UI that displays a failure MUST go through this mapping — no component may render a caught error's raw `message`/`String(err)` directly (the pattern used today in `Account.tsx`, `IpClients.tsx`, `Actions.tsx`, `NotificationSettings.tsx`).

## Shape

```ts
function toUserMessage(err: unknown): string;
```

Always returns a non-empty, plain-language string. Never throws. Never returns a value containing an HTTP status number, a backend `{ error: "..." }` string verbatim, a stack trace, or internal terms such as "event", "aggregate", "tenant", or a raw exception's `.message` unless that exact string has been deliberately whitelisted in the catalog as already plain-language.

## Known mappings (initial set — extend as new backend error shapes are found during implementation)

| Backend shape | User-facing message |
|---|---|
| HTTP 400 from `PUT /account/password` (`newPassword must be at least 8 characters`) | "Your new password needs to be at least 8 characters." |
| HTTP 502 from `PUT /account/password` (Logto Management API failure) | "We couldn't update your password right now. Please try again in a moment." |
| HTTP 404 from `GET /notification-channel` | *(not an error — treated as "no channel configured yet", per existing `NotificationSettings.tsx` handling)* |
| Any action-execution failure recorded with an error reason (per `specs/001-ip-change-automation`) | The Execution Record's own human-readable failure reason, only if it is already free of raw provider/HTTP detail; otherwise a generic "This update didn't go through — see details below" wrapping whatever safe summary is available. |
| Network failure / request never reached the server (`TypeError: Failed to fetch`, timeouts) | "We couldn't reach FluxIP. Check your connection and try again." |
| Anything unrecognized (fallback) | "Something went wrong. Please try again." |

## Invariants

1. **Total function**: every code path that currently does `err instanceof Error ? err.message : String(err)` is replaced by `toUserMessage(err)`; there is no remaining call site that displays a raw caught value.
2. **Fallback never leaks detail**: the fallback branch must not interpolate any part of the original error into its output.
3. **One catalog, not per-page copy**: new backend error shapes discovered during implementation are added as new rows here, not as ad hoc strings inline in a page component (research.md §8).
