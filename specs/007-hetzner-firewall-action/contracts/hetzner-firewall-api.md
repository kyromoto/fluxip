# Contract: Hetzner Cloud Firewall API (external dependency)

The exact upstream surface this feature integrates with — analogous to how 001's research.md §18 pinned down the specific Hetzner Cloud DNS endpoints the DNS Action uses. All calls go through the current Hetzner Cloud API (`https://api.hetzner.cloud/v1`), per FR-013/FR-035 of 001 — never the legacy, separate Hetzner DNS API, which has no bearing here anyway since firewalls were never part of it.

| Method & Path | Used for | Notes |
|---|---|---|
| `GET /firewalls/{id}` | Reading the current rule set (FR-008/FR-018) | Response's `rules[]` items: `{ direction, protocol, port?, source_ips?, destination_ips?, description? }`. `source_ips` applies when `direction: "in"`, `destination_ips` when `direction: "out"` — the executor reads/writes whichever field matches the configured `direction` |
| `POST /firewalls/{id}/actions/set_firewall_rules` | Writing the full rule set back (FR-005/FR-006) | Body: `{ rules: [...] }` — **replaces the entire rule array in one call; there is no partial-patch endpoint.** This is why every write is a locked read-modify-write cycle (research.md §2), never a targeted single-rule update |

## Address format

`source_ips`/`destination_ips` entries are CIDR strings. A single address from an IP Client's `ipValues` is suffixed to CIDR form before being written: IPv4 → `/32`, IPv6 → `/128` (FR-014).

## Firewall identity

Hetzner Cloud Firewalls are identified by an integer ID (not a UUID/string like FluxIP's own aggregate IDs) — `config.firewallId` in data-model.md is typed `number` to match.

## Failure modes this feature must diagnose

| Condition | Surfaced as |
|---|---|
| Non-2xx / non-JSON response from either call | Same diagnosable-error convention already used by `hetzner-dns-executor.ts`'s `requestJson` (status + body snippet in the thrown error) |
| Credential lacks permission to read/write the firewall | Same shape as an invalid token — Hetzner returns a non-2xx; no separate handling needed (FR-012 assumes the existing Hetzner credential type already covers this) |
| Rule selector doesn't resolve to exactly one rule in the `GET` response | Handled by `matchFirewallRule` (data-model.md), not a Hetzner-side error — Hetzner itself has no concept of "the rule I meant" |

## Explicitly out of scope for this feature

- Creating or deleting firewalls or rules (`POST /firewalls`, rule-array entries beyond the one targeted rule's addresses) — this Action type only ever mutates the address list of an already-existing rule (spec.md Assumptions).
- Any Hetzner Firewall API surface unrelated to reading/writing rules (e.g. attaching a firewall to a server, firewall labels) — not used by this feature.
