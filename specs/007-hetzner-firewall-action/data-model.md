# Phase 1 Data Model: Hetzner Cloud Firewall Rule Action

This feature extends the `action` aggregate already defined in `specs/001-ip-change-automation/data-model.md` (event-sourced; own aggregate stream per `actionId`; every event carries `account_id`). It does **not** introduce a new aggregate — a Firewall Rule Update Action is just a second `type` value the existing `action` aggregate already anticipated (FR-009 of 001). Only the deltas are documented below; see 001's `data-model.md` for the full original shape, the relationships diagram, and the cross-cutting rules (account isolation, event-store immutability, disposable projections), which continue to apply unchanged.

## Aggregate: `action` (extended)

**Derived state** (changes from 001 in **bold**):

| Field | Type | Notes |
|---|---|---|
| `actionId` | string | Aggregate ID — unchanged |
| `accountId` | string | Unchanged |
| `ipClientId` | string | Unchanged |
| `type` | string | Now one of `"hetzner_cloud_dns_update"` \| **`"hetzner_cloud_firewall_rule_update"`** |
| `addressFamilies` | subset of `{ipv4, ipv6}` | Unchanged in shape; for this type, drives which of `firewallOwnedEntries.ipv4`/`.ipv6` are actively maintained |
| `config` | `ActionConfig` | Now a union: `UpdateDnsRecordConfig` \| **`UpdateFirewallRuleConfig`** (new, below) |
| **`firewallOwnedEntries`** | **`{ ipv4?: string; ipv6?: string }`** | **NEW — the CIDR this Action itself last successfully wrote into the target rule, per address family (research.md §1). Empty/absent for a DNS Action, and for a Firewall Rule Update Action that has never successfully executed.** |

**Config shape** — `UpdateFirewallRuleConfig` (new, sibling to `UpdateDnsRecordConfig`):

| Field | Type | Notes |
|---|---|---|
| `providerCredentialId` | string | Same Hetzner Provider Credential type reused from the DNS Action (FR-012) |
| `firewallId` | number | Hetzner's own integer Firewall ID (Hetzner Cloud Firewalls are int-identified, not UUID-identified) |
| `direction` | `"in"` \| `"out"` | Part of the rule selector (FR-003) |
| `protocol` | `"tcp"` \| `"udp"` \| `"icmp"` \| `"esp"` \| `"ah"` \| `"gre"` | Part of the rule selector; matches Hetzner's Firewall Rule `protocol` enum |
| `port` | string, optional | Part of the rule selector; only meaningful (and only ever present) when `protocol` is `"tcp"` or `"udp"` |
| `description` | string, required | Part of the rule selector — required specifically because `direction`+`protocol`+`port` alone is not guaranteed unique among a firewall's rules (FR-003) |

Together, `direction`+`protocol`+`port`+`description` are the "rule selector" referenced throughout spec.md — matched via the shared `matchFirewallRule` function (research.md §5) against the firewall's live rules, both at configuration time (FR-018) and at execution time (FR-008).

**Events** (changes from 001 in **bold**):

- `action.attached` — unchanged shape; `type`/`config` now may hold the firewall variant.
- `action.reconfigured` — unchanged shape.
- `action.enabled` / `action.disabled` — unchanged.
- `action.detached` — unchanged.
- **`action.firewall_rule_applied`** — **NEW.** `{ actionId, ipv4?: string, ipv6?: string, appliedAt }`. Appended by the action-execution worker (not an HTTP route) after a successful firewall write, carrying only the address-family/CIDR pairs actually written in that execution (research.md §1). Folded into `firewallOwnedEntries`, overwriting only the families present in the event.

**Invariants** (changes from 001 in **bold**):

- `config.providerCredentialId` must reference a `provider_credential` owned by the same `accountId` — unchanged, now also enforced for the firewall config variant.
- **For a Firewall Rule Update Action, `config`'s rule selector (`firewallId`+`direction`+`protocol`+`port`+`description`) MUST resolve to exactly one existing rule on that firewall at both configuration time (FR-018, checked synchronously against the Hetzner Cloud API before `action.attached`/a reconfiguring `action.reconfigured` is appended) and at each execution time (FR-008, re-checked by the executor since the live firewall can drift after configuration).**
- **`firewallOwnedEntries` is written only by the worker (`action.firewall_rule_applied`), never by the HTTP routes; it is advisory bookkeeping for "what to remove next time," not a source of truth for what's actually in Hetzner (a manual Console edit can always diverge from it — see spec.md Clarifications/Assumptions on the scope of the no-lost-updates guarantee).**
- **On Detach, and on a Reconfigure that drops a previously-managed address family, the system attempts (once, best-effort, no retry) to remove that family's `firewallOwnedEntries` CIDR from the target rule — but the Detach/Reconfigure domain event itself is appended unconditionally first (FR-011/FR-017); the Hetzner-side cleanup never blocks or reverts it.**

## Relationship to `provider_credential` and `ip_client` (unchanged from 001)

```text
ip_client (1) ──< (many) action
action (many) ──> (1) provider_credential   [config.providerCredentialId]
```

No new relationship is introduced — a Firewall Rule Update Action participates in both exactly like a DNS Update Action does.

## Non-persisted domain type: rule selector match result

Not an aggregate or event — a pure function's return type (research.md §5), documented here because both the HTTP route and the executor depend on its shape:

```text
matchFirewallRule(rules: HetznerFirewallRule[], selector: RuleSelector)
  → { rule: HetznerFirewallRule }
  | { error: "no_match" }
  | { error: "ambiguous_match"; matchCount: number }
```

`"no_match"`/`"ambiguous_match"` map to FR-018's `400`/`422` at configuration time and to FR-008's execution failure (surfaced through the existing `action_execution.failed` event, unchanged from 001) at execution time.
