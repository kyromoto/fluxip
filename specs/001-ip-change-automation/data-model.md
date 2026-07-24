# Phase 1 Data Model: IP-Change-Triggered Automation (FluxIP Core)

This document defines the event-sourced domain model: one section per aggregate (its own independent event stream, identified by `aggregate_id`), the events it emits, its derived state, and its invariants. All aggregate and event names were reviewed and confirmed with the team before being written here (see plan.md's naming-confirmation step). Every event additionally carries a `tenant_id` (the owning `account`'s aggregate ID) per the tenant-isolation guardrail in research.md §8, even where not repeated below.

Terminology note: this document uses **IP Client** throughout as the technical/aggregate name for what the spec (spec.md) calls a **Trigger Device** — same concept, business term vs. code/event name.

## Aggregate: `account`

The tenant root. One `account` aggregate exists per registered user; its aggregate ID **is** the tenant ID, and (per research.md §7) is set to the Logto subject claim from the verified OIDC token.

**Derived state**:

| Field | Type | Notes |
|---|---|---|
| `accountId` | string (= tenant ID = Logto subject) | Primary identity |
| `registeredAt` | timestamp | From `registered` |
| `deviceLimit` | integer | Starts at the deployment-configured default (`DEFAULT_IP_CLIENT_LIMIT` env var); overridden by `device_limit_overridden` |
| `status` | `active` \| `closed` | Terminal once `closed` |

**Events**:

- `account.registered` — `{ accountId, registeredAt }`
- `account.device_limit_overridden` — `{ accountId, previousLimit, newLimit, overriddenBy, overriddenAt }` (`overriddenBy` = the administrator's identifier; FR-034)
- `account.closed` — `{ accountId, closedAt }`

**Invariants**: `deviceLimit >= 0`. FR-003's device-count check (create-IP-Client is rejected once `deviceLimit` is reached) is evaluated by replaying this aggregate alongside a count of that tenant's non-decommissioned `ip_client` aggregates.

**Lifecycle note (research.md §12)**: `account.closed` is not a normal terminal state to query later — it is the trigger for an immediate, synchronous hard-delete of every event for this `tenant_id` across all aggregates (FR-032), plus purge of any in-flight BullMQ jobs and Redis projection keys namespaced to it. After that purge completes, no aggregate for this tenant exists to replay.

## Aggregate: `ip_client`

Represents one registered device (the spec's "Trigger Device") that reports public-IP changes.

**Derived state**:

| Field | Type | Notes |
|---|---|---|
| `ipClientId` | string | Aggregate ID |
| `accountId` | string | Owning tenant |
| `label` | string | User-chosen display name |
| `credentialHash` | string | Salted hash of the current system-generated reporting credential (research.md §14) — never the plaintext |
| `status` | `enabled` \| `disabled` \| `decommissioned` | |
| `lastKnownIPv4` | string \| null | Updated only by `ip_changed`, never by the raw `ip_report_received` |
| `lastKnownIPv6` | string \| null | Same as above |
| `notificationPreference` | `off` \| `failures_only` \| `all` | Default `off` (FR-029; notifications are opt-in) |

**Events**:

- `ip_client.registered` — `{ ipClientId, accountId, label, credentialHash, registeredAt }`. The plaintext credential is generated at command-handling time, returned once in the API response, and never appears in this or any other event.
- `ip_client.credential_rotated` — `{ ipClientId, credentialHash, rotatedAt }` (FR-019; old credential is invalid the instant this event is appended)
- `ip_client.enabled` / `ip_client.disabled` — `{ ipClientId }` (FR-017)
- `ip_client.decommissioned` — `{ ipClientId, decommissionedAt }` (irreversible; a new IP Client must be registered to replace it)
- `ip_client.ip_report_received` — `{ ipClientId, reportedIPv4?, reportedIPv6?, receivedAt }`. Raw, pre-debounce; recorded for every inbound authenticated report, even ones that turn out unchanged or superseded by flapping.
- `ip_client.ip_changed` — `{ ipClientId, previousIPv4?, newIPv4?, previousIPv6?, newIPv6?, settledAt }`. Appended only after the 30s debounce window (research.md §6) settles on a value that differs from the last known one (FR-006); this is what downstream Action execution reacts to.
- `ip_client.notification_preference_set` — `{ ipClientId, notificationPreference }` (FR-029)

**Invariants**: A disabled or decommissioned IP Client's inbound reports are still authenticated but MUST NOT produce `ip_report_received`/trigger any execution (FR-017 disable semantics); `decommissioned` is terminal — no further events except none are accepted for this aggregate.

## Aggregate: `action`

A user-configured unit of work attached to one `ip_client`.

**Derived state**:

| Field | Type | Notes |
|---|---|---|
| `actionId` | string | Aggregate ID |
| `accountId` | string | Owning tenant |
| `ipClientId` | string | The IP Client this Action reacts to |
| `type` | string, extensible | `"update_dns_record"` is the only value in this iteration (FR-008/FR-009) |
| `addressFamilies` | subset of `{ipv4, ipv6}` | Which reported families this Action requires (FR-025/FR-026/FR-027) |
| `config` | type-specific object | For `update_dns_record`: `{ providerCredentialId, zone, recordName }` — record must already exist (FR-008) |
| `status` | `enabled` \| `disabled` | FR-017 |

**Events**:

- `action.attached` — `{ actionId, accountId, ipClientId, type, addressFamilies, config, attachedAt }`
- `action.reconfigured` — `{ actionId, addressFamilies?, config?, reconfiguredAt }`
- `action.enabled` / `action.disabled` — `{ actionId }`
- `action.detached` — `{ actionId, detachedAt }`

**Invariants**: `addressFamilies` must be non-empty and a subset of what the Action `type` supports; `config.providerCredentialId` must reference a `provider_credential` owned by the same `accountId` (FR-013).

## Aggregate: `action_execution`

One independent run of one `action`, for one triggering cause. Given its own aggregate identity (rather than folded into `action`) so each attempt is independently addressable for history display (spec's "Execution Record") and manual re-run (FR-023).

**Derived state**:

| Field | Type | Notes |
|---|---|---|
| `executionId` | string | Aggregate ID |
| `accountId` | string | Owning tenant |
| `actionId` | string | The Action being executed |
| `ipClientId` | string | Denormalized for query convenience |
| `triggeredBy` | `ip_change` \| `manual` | FR-010 vs FR-023 |
| `causationEventId` | string | The `ip_client.ip_changed` event ID, or the manual-request's ID |
| `ipValuesUsed` | `{ ipv4?, ipv6? }` | The address values the execution acted on |
| `status` | `running` \| `succeeded` \| `failed` | |
| `attempt` | integer | 1-based; increments across `retry_scheduled` |
| `error` | string \| null | Present when `status = failed` |

**Events**:

- `action_execution.started` — `{ executionId, accountId, actionId, ipClientId, triggeredBy, causationEventId, ipValuesUsed, attempt, startedAt }`
- `action_execution.succeeded` — `{ executionId, completedAt, providerResponseSummary }`
- `action_execution.failed` — `{ executionId, attempt, error, retriesExhausted, failedAt }` (FR-011/edge case: failure of one Action's execution never blocks another, per FR-022)
- `action_execution.retry_scheduled` — `{ executionId, nextAttempt, nextAttemptAt }` (research.md §5: up to 5 attempts, 30s exponential backoff)
- `action_execution.notification_sent` — `{ executionId, channelId, outcomeNotified, sentAt }` (FR-030)

**Invariants**: Independent per `action` — one `ip_client.ip_changed` event fans out into one `action_execution` per enabled Action on that IP Client, each succeeding/failing on its own (FR-022). A `manual` execution reuses the IP Client's current `lastKnownIPv4`/`lastKnownIPv6` at request time (FR-023), not a new report.

## Aggregate: `provider_credential`

A user-owned secret used by one or more of that user's Actions to authenticate against a third-party provider (e.g., a Hetzner Cloud API token — research.md §18; the older, separate Hetzner DNS Console/API token format is never accepted, per FR-035).

**Derived state**:

| Field | Type | Notes |
|---|---|---|
| `credentialId` | string | Aggregate ID |
| `accountId` | string | Owning tenant |
| `provider` | string, extensible | `"hetzner"` in this iteration |
| `label` | string | User-chosen display name |
| `encryptedSecretRef` | string | Reference to the encrypted secret value (reversibly encrypted, unlike the IP Client credential — this one must be decrypted to call the provider's API) |
| `status` | `active` \| `revoked` | |

**Events**:

- `provider_credential.stored` — `{ credentialId, accountId, provider, label, encryptedSecretRef, storedAt }`
- `provider_credential.rotated` — `{ credentialId, encryptedSecretRef, rotatedAt }`
- `provider_credential.revoked` — `{ credentialId, revokedAt }`

**Invariants**: Reusable across any number of that account's `action` aggregates (FR-020); revoking a credential does not retroactively alter Actions referencing it, but their next execution will fail (surfaced per FR-011) until reconfigured with a live credential.

## Aggregate: `notification_channel`

A user-owned destination that receives notifications about Action executions.

**Derived state**:

| Field | Type | Notes |
|---|---|---|
| `channelId` | string | Aggregate ID |
| `accountId` | string | Owning tenant |
| `type` | string, extensible | `"email"` in this iteration |
| `addresses` | string[] | One or more email addresses (FR-028) |
| `status` | `active` \| `revoked` | |

**Events**:

- `notification_channel.registered` — `{ channelId, accountId, type, addresses, registeredAt }`
- `notification_channel.reconfigured` — `{ channelId, addresses, reconfiguredAt }`
- `notification_channel.revoked` — `{ channelId, revokedAt }`

**Invariants**: An `ip_client` with `notificationPreference != off` but no active `notification_channel` on its account simply results in no notification being sent (edge case in spec.md) — this is not an error state.

## Actors (not separate aggregates)

- **User**: identified by the verified OIDC token's subject claim; corresponds 1:1 to an `account` aggregate ID.
- **Administrator**: an operator identity (distinguished via a Logto role/claim) whose only recorded effect in this iteration is `account.device_limit_overridden`; no dedicated aggregate exists for it in v1.

## Relationships

```text
account (1) ──< (many) ip_client
account (1) ──< (many) provider_credential
account (1) ──< (many) notification_channel
ip_client (1) ──< (many) action
action (1) ──< (many) action_execution
action (many) ──> (1) provider_credential   [config.providerCredentialId]
```

## Cross-cutting rules (apply to every aggregate above)

1. **Tenant isolation** (FR-012/FR-013): every event carries `accountId`/`tenant_id`; every read/write repository call requires it as a parameter and filters on it at the query level (research.md §8), never only in application logic.
2. **Event store immutability, with one exception**: all events above are append-only and never mutated or deleted, *except* the full hard-delete of a tenant's events triggered by `account.closed` (research.md §12).
3. **Projections are disposable**: any Redis-held read model (IP Client lists, execution history pages, last-known-IP for UI display) is rebuilt from these events and is never consulted to decide whether an Action should run — that decision always replays Postgres directly (research.md §8).
4. **Replay metrics**: every aggregate replay is timed and counted, labeled by aggregate type (and `ipClientId` where applicable), per research.md §10.
