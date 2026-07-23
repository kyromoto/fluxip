# Contract: IP-Change Trigger Endpoint

Public, unauthenticated-by-session endpoint that an IP Client's own router (e.g., FritzBox) calls natively via its built-in "custom DynDNS provider" client. Implements the **dyndns2** protocol subset (research.md §15) so no custom firmware/scripting is required.

## `GET /nic/update`

**Auth**: HTTP Basic Auth. Username/password = the IP Client's system-generated reporting credential (FR-004; research.md §14). Invalid, missing, or credential belonging to a `decommissioned` IP Client → `401`.

**Query parameters**:

| Param | Required | Notes |
|---|---|---|
| `hostname` | yes | Opaque identifier the router was configured with; resolved server-side to an `ip_client_id` via the Basic Auth credential, not trusted as an identity on its own |
| `myip` | no | Reported IPv4 address. If omitted, the server uses the connecting request's source IP as the IPv4 value. |
| `myip6` | no | Reported IPv6 address, if the router supports dual-stack reporting (feeds FR-025 IPv6-configured Actions) |

**Behavior**:

1. Authenticate via Basic Auth → resolve `ip_client_id` + `accountId`. Reject (`401`) on failure.
2. If the resolved IP Client's `status` is `disabled` or `decommissioned` → respond `badauth` (dyndns2 convention) and take no further action.
3. Append `ip_client.ip_report_received` with whatever of `myip`/`myip6` was supplied (or the inferred source IP for `myip`).
4. (Re)schedule the 30s debounce job (research.md §6) for this `ip_client_id`. Do not block the response on this.
5. Respond within the endpoint's <200ms p95 target (plan.md Performance Goals).

**Response** (dyndns2-convention plaintext body, `200 OK` unless noted):

| Body | Meaning |
|---|---|
| `good <ip>` | Report accepted (does not imply an Action already ran — that happens asynchronously after debounce) |
| `nochg <ip>` | Reported value matches the last known value; still a no-op per FR-006 |
| `badauth` | Credential invalid/revoked, or IP Client disabled/decommissioned (`401`) |
| `911` | Transient server error; router's client will retry per dyndns2 convention (`503`) |

**Out of scope for this endpoint**: it never returns Action-execution outcomes (success/failure of the DNS update) — those are visible only via the management API's execution history (see `management-api.md`), since execution happens asynchronously after this endpoint has already responded.
