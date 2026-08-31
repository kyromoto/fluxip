# Phase 1 Data Model: Operational Logging & Traceability

This feature introduces **no new persisted aggregate and no event-sourcing change**. Per `spec.md`'s own Key Entities section, an "Operation" is explicitly "not a new stored entity" — it's a way of reading related, transient log records together. This document describes the two log record *shapes* (what fields each entry carries) and how they relate to entities already defined in `001-ip-change-automation/data-model.md`.

## Application Log Entry (transient — not stored, not queryable via any new API)

A structured LogTape `LogRecord` emitted under the `["fluxip", "app", ...]` category tree.

| Field | Type | Notes |
|---|---|---|
| `category` | string[] | e.g. `["fluxip", "app", "trigger"]`, `["fluxip", "app", "action-execution"]` — identifies which part of the system emitted it |
| `level` | `"debug"` \| `"info"` \| `"warning"` \| `"error"` \| `"fatal"` | `"error"`/`"fatal"` for FR-003's error entries; `"info"` for normal lifecycle entries |
| `message` | string (template) | Human-readable, e.g. `"IP change confirmed for {ipClientId}"` |
| `correlationId` | string \| absent | Present on every entry belonging to a traceable operation (FR-004); **absent** on raw `ip_report_received` entries (research.md §3) since those precede any confirmed operation. Value = the existing `causationEventId`: the `ip_client.ip_changed` event's own ID for automatic executions, or the manual request's own ID for a manual re-run (`data-model.md`'s `action_execution.causationEventId` in 001, unchanged) |
| `accountId` | string | The owning account — always present, consistent with 001's account-isolation cross-cutting rule |
| `ipClientId` | string \| absent | Present on trigger-report, ip-changed, and execution-related entries |
| `actionId` / `executionId` | string \| absent | Present on Action-execution entries (FR-002/FR-005) |
| `outcome` | `"succeeded"` \| `"failed"` \| absent | Present on execution-outcome entries |
| `error` | string \| absent | Present on failed-execution and error entries (FR-003/FR-005); never a secret value (FR-009) |

**Emission points** (mapped to existing 001 code, per plan.md's Project Structure):

| Point in existing code | Log entry | Correlation ID? |
|---|---|---|
| `trigger.ts`, after `ip_client.ip_report_received` is appended | "trigger report received" | No — precedes any confirmed operation (research.md §3) |
| `debounce-worker.ts`, after `ip_client.ip_changed` is appended | "IP change confirmed" | Yes — `causationEvent.id` (the root) |
| `execution-fanout-worker.ts`, per enqueued Action | "execution enqueued" | Yes — `params.causationEventId` |
| `action-execution-worker.ts`, job start / success / failure | "execution started" / "execution succeeded" / "execution failed" | Yes — `job.data.causationEventId` |
| `action-execution-worker.ts`, `maybeSendNotification` catch block (replaces the existing raw `console.error`) | "notification send failed" | Yes — same execution's `causationEventId` |
| `action-run.ts`, at manual-re-run job enqueue | "manual execution requested" | Yes — its own freshly-generated `causationEventId` (not the original operation's) |

## Access Log Entry (transient — written to the rotating file, not queryable via any new API)

A structured LogTape `LogRecord` emitted under the single `["fluxip", "access"]` category by `@logtape/hono`'s `honoLogger()` middleware, extended with one `enrich`-added field.

| Field | Type | Notes |
|---|---|---|
| `category` | string[] | Always `["fluxip", "access"]` — the one category this stream ever uses |
| `method` | string | HTTP method |
| `url` / `path` | string | Full URL and path |
| `status` | number | Response status code, including 401s from failed auth (FR-007) |
| `responseTime` | number (ms) | |
| `contentLength` | string \| absent | Response `Content-Length`, where present |
| `userAgent` / `referrer` | string \| absent | Standard request headers |
| `sourceIp` | string \| absent | Added via the `enrich` callback (research.md §7); connection remote address, falling back to `X-Forwarded-For` |
| `requestId` | string | Set when `context: true`/`context: {...}` is configured; independent of, and never equal to, an Application Log `correlationId` — the Access Log entry exists whether or not any Application Log entry does (FR-007) |

## Relationship to 001-ip-change-automation's existing entities (unchanged)

```text
ip_client.ip_report_received  →  Application Log entry (no correlation ID)
ip_client.ip_changed          →  Application Log entry (correlation ID = this event's own id)
action_execution.started/succeeded/failed
                               →  Application Log entry (correlation ID = action_execution.causationEventId, verbatim)
[any HTTP request]            →  Access Log entry (independent of all of the above)
```

No field on any existing 001 event changes shape or meaning; this feature only reads values (`causationEventId`, event IDs) that already exist and writes them into log calls.
