# Contract: Management-API (UI)

Alle Pfade liegen unter `/api` und sind durch die bestehende OIDC-Authentifizierung geschützt (kontogebunden, wie `provider-credentials`). Fremde IDs ergeben `404`, nie `403`.

## Provider-Konfigurationen

### `POST /api/traefik-providers`

Request:

```json
{ "name": "Standort Nord", "connectionMode": "agent_initiated" }
```

`connectionMode` ist optional (Standard `agent_initiated`).

Antworten:

| Status | Bedeutung |
|---|---|
| `201` | angelegt, Body siehe unten |
| `400` | `name` fehlt oder leer |
| `409` | `name_in_use` |
| `422` | `connection_mode_not_available` (für `server_initiated`) |

`201`-Body (das Token erscheint **nur hier und nur einmal**):

```json
{
  "providerId": "01J…",
  "name": "Standort Nord",
  "connectionMode": "agent_initiated",
  "agentAddress": "https://agents.example.com/01J…",
  "token": { "tokenId": "01J…", "value": "fxt_…", "last4": "ab12" },
  "setup": {
    "startCommand": "docker run -d --name fluxip-agent -e FLUXIP_ADDRESS=… -e FLUXIP_TOKEN=… -v /etc/traefik/dynamic:/out -v ./templates:/templates ghcr.io/…/fluxip-agent:<version>",
    "traefikSnippet": "providers:\n  file:\n    directory: /etc/traefik/dynamic\n    watch: true\n",
    "notes": ["Entferne bestehende manuelle Definitionen gleichnamiger Middlewares, sonst entsteht ein Namenskonflikt."]
  }
}
```

### `GET /api/traefik-providers`

```json
{ "items": [ {
  "providerId": "…", "name": "…", "connectionMode": "agent_initiated",
  "agentAddress": "…",
  "state": "connected | disconnected | stale | never_connected",
  "lastConnectedAt": "…", "lastDisconnectedAt": "…",
  "appliedVersion": 42, "publishedVersion": 42,
  "agentVersion": "1.0.0",
  "lastError": { "version": 41, "reason": "…", "at": "…" },
  "notices": ["previous_session_superseded"],
  "tokens": [ { "tokenId": "…", "last4": "ab12", "issuedAt": "…", "status": "valid | revoked" } ],
  "actionCount": 3
} ] }
```

Die Zustandswerte sind ASCII (`connected`, `disconnected`, `stale`, `never_connected`); die UI übersetzt sie. `lastPublishError` (`{reason, at}`) nennt, warum kein neuer Stand veröffentlicht werden konnte (z. B. `too_large`). `notices` enthält Hinweise wie `previous_session_superseded` (Randfall "zwei Agents").

### `GET /api/traefik-providers/:id`

Wie ein Listeneintrag, zusätzlich `usedBy: [{actionId, ipClientId, ipClientName, group, status}]` und `groups: [string]` (alle in Aktionen verwendeten Gruppen, für Vorschläge, US2-1).

### `PATCH /api/traefik-providers/:id`

`{ "name": "…" }` → `200` mit Listeneintrag. `409 name_in_use`. Die Verbindungsart ist nicht änderbar (`422 immutable_field`).

### `DELETE /api/traefik-providers/:id`

| Status | Bedeutung |
|---|---|
| `204` | gelöscht |
| `404` | unbekannt oder fremd |
| `409` | `traefik_provider_in_use` mit `usedBy: [{actionId, ipClientId, group}]` (FR-006) |

## Tokens

### `POST /api/traefik-providers/:id/tokens`

Erzeugt ein weiteres Token (Rotation ohne Ausfall, US7-1).

- `201` `{ "tokenId": "…", "value": "fxt_…", "last4": "…" }` (Klartext nur hier)
- `409 token_limit_reached`, wenn schon zwei gültige existieren

### `DELETE /api/traefik-providers/:id/tokens/:tokenId`

Widerruft sofort, beendet Sitzungen, die mit diesem Token authentifiziert wurden (US7-2).

- `204`, `404`, wiederholtes Widerrufen ist `204` (idempotent)

## Aktion `traefik_config_delivery`

Verwendet die bestehenden Aktions-Endpunkte (siehe `routes/actions.ts`). Neu ist der Typ:

`POST /api/ip-clients/:ipClientId/actions`

```json
{
  "type": "traefik_config_delivery",
  "config": { "traefikProviderId": "01J…", "group": "admin-allowlist" }
}
```

`addressFamilies` ist optional und wird ignoriert (beide Familien werden geliefert).

| Status | Bedeutung |
|---|---|
| `201` | angelegt |
| `404` | `traefik_provider_not_found` (auch für fremde Konten) |
| `422` | `invalid_group` |

`PUT` (Rekonfiguration) akzeptiert denselben `config`. `POST …/run` (manueller Lauf) → `409 not_runnable` für diesen Typ.

## Lieferstatus

`GET /api/ip-clients/:ipClientId/delivery-status`

Bewusst eigener Endpunkt, nicht Teil der Aktionsliste (research.md §5, Aktionsprojektion bleibt statusfrei).

```json
{ "items": [ {
  "actionId": "…", "traefikProviderId": "…", "group": "…",
  "status": "applied | pending | error | agent_disconnected | disabled",
  "publishedVersion": 42, "appliedVersion": 42,
  "error": { "reason": "…", "at": "…" }
} ] }
```

Ableitung: research.md §12.

## Fehlerformat

Wie im Bestand: `{ "error": "<code>", … }` mit zusätzlichen Feldern je Fall (`usedBy`).

## Auswirkungen auf bestehende Endpunkte

| Endpunkt | Änderung |
|---|---|
| `POST /api/ip-clients/:id/{enable,disable}`, `DELETE /api/ip-clients/:id` | plant Neuberechnung der betroffenen Provider |
| `POST/PUT/DELETE …/actions…`, enable/disable | plant Neuberechnung (alter und neuer Provider) |
| `DELETE /api/provider-credentials/:id` | Typ-Eingrenzung der `ActionConfig`-Union, Verhalten unverändert |
| Konto schließen | beendet Sitzungen |
