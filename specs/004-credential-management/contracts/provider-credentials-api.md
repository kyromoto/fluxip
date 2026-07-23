# Contract: Provider Credentials API (supersedes the "Provider Credentials" section of 001's `management-api.md`)

REST endpoints under the existing authenticated Management API (Logto-verified `Authorization: Bearer <token>`; the token's subject claim determines `accountId` for every request — see 001's `contracts/management-api.md` for the shared auth model, which is unchanged). Response bodies below are illustrative field lists, not a full OpenAPI schema.

**This document supersedes 001's four-line "Provider Credentials" table** for the two endpoints it originally sketched (`POST`/`DELETE`), per this feature's clarifications: deletion is now blocked while referenced (001 had said "not blocked at revoke time"), and in-place rotation is dropped from this iteration's scope (see data-model.md).

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/provider-credentials` | List the caller's own credential entries | Each item: `{ credentialId, provider, label, secretLast4 }`. **Never** includes the full secret. Only `active` entries are returned (FR-001/FR-006). Served by direct aggregate replay (research.md §8) |
| `POST /api/provider-credentials` | Create a new credential entry | Body: `{ provider, label, secret }`. `secret` is accepted once for encryption at rest and is never returned again in this or any later response (only `secretLast4` is, from here on) (FR-002/FR-004a). `201` body: `{ credentialId, provider, label, secretLast4 }` |
| `DELETE /api/provider-credentials/{id}` | Permanently delete (revoke) an entry | `204` on success. **`409` if ≥1 Action (enabled or disabled) still references it**: body `{ error: "credential_in_use", usedBy: [{ actionId, ipClientId, zone, recordName }] }` (FR-009/FR-010) |

## Validation errors

| Status | `error` body | Condition |
|---|---|---|
| `400` | `"provider, label, and secret are required"` | Missing required field on create |
| `409` | `"label already in use"` | A case-insensitive duplicate of an existing active entry's `label` for this account (FR-003) |
| `409` | `"credential_in_use"` (+ `usedBy`) | Delete attempted while referenced (FR-010) |
| `404` | — | `id` doesn't exist, isn't `active`, or doesn't belong to the caller's account (FR-014) — same not-found-not-forbidden convention as the rest of the Management API |

## Unchanged from 001

- Every list/get/delete scopes to the caller's `accountId` at the query layer; a request for another tenant's credential ID returns `404`, not `403` (FR-014, matching the cross-cutting convention in 001's `management-api.md`).
- `Action` creation/reconfiguration (`POST /api/ip-clients/{ipClientId}/actions`, `PUT /api/actions/{id}`) continues to validate that `config.providerCredentialId` refers to an `active` credential owned by the same account, unchanged from 001.

## Explicitly out of scope for this feature

- `POST /api/provider-credentials/{id}/rotate` — **not implemented in this iteration** (data-model.md; spec Assumptions). 001's `management-api.md` sketched this endpoint; it is not built as part of 004. To change a token, delete the (unreferenced) entry and create a new one.
