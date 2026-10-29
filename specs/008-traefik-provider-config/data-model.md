# Data Model: Verteilung dynamischer Traefik-Konfiguration an Agents

Namen sind Vorschläge (research.md §15) und werden vor Übernahme bestätigt. Alle Aggregate liegen im bestehenden Ereignisspeicher (`events`, kontogebunden). Es gibt keine Schemaänderung.

## Aggregat `traefik_provider` (Provider-Konfiguration)

Aggregat-ID: ULID (`providerId`). Sie ist global eindeutig und Teil der Agent-Adresse; `resolveAccountId("traefik_provider", id)` findet das Konto.

### Ereignisse

| Ereignis | Daten | Auslöser |
|---|---|---|
| `created` | `providerId`, `accountId`, `name`, `connectionMode`, `createdAt` | Benutzer legt an (FR-001) |
| `renamed` | `name`, `renamedAt` | Benutzer ändert den Namen |
| `deleted` | `deletedAt` | Benutzer löscht (nur ohne verwendende Aktionen, FR-006) |
| `token_issued` | `tokenId`, `tokenHash`, `last4`, `issuedAt` | Benutzer erzeugt Token (FR-003) |
| `token_revoked` | `tokenId`, `revokedAt` | Benutzer widerruft |
| `snapshot_published` | `contentHash`, `groupCount`, `entryCount`, `correlationId`, `absorbedCausationIds?`, `publishedAt` | Publisher, nur bei geändertem Inhalt |
| `snapshot_publish_failed` | `reason` (`too_large` \| `internal`), `correlationId`, `absorbedCausationIds?`, `failedAt` | Publisher, z. B. Größenlimit (FR-024) |
| `agent_connected` | `sessionId`, `tokenId`, `agentVersion`, `protocolVersion`, `maxOfflineSeconds`, `replacedPrevious`, `connectedAt` | Sitzung steht (FR-060, FR-034) |
| `agent_disconnected` | `sessionId`, `reason` (`closed` \| `superseded` \| `revoked` \| `timeout` \| `error`), `disconnectedAt` | Sitzung endet |
| `snapshot_applied` | `version`, `correlationId`, `agentVersion`, `stale`, `files[{name, sha256}]`, `templates[{name, sha256}]`, `traefikCheck?`, `appliedAt` | Bericht `ok` (FR-054) |
| `snapshot_apply_failed` | `version`, `correlationId`, `reason`, `appliedAt` | Bericht `error` |

Hinweis zu Rückmeldungen: Ein Bericht mit Ergebnis `ignored_stale` (Agent hat die Version wegen FR-053 verworfen) erzeugt **kein** Ereignis, nur eine Logzeile.

### Zustand (Reducer `TraefikProviderState`)

```text
providerId, accountId, name
connectionMode          "agent_initiated" | "server_initiated"   (nur Ersteres wählbar)
status                  "active" | "deleted"
tokens                  Map<tokenId, { hash, last4, issuedAt, revokedAt? }>
lastPublished           { version, contentHash, correlationId, publishedAt } | null
lastPublishError        { reason, correlationId, failedAt } | null
lastConnectedAt         ISO | null
lastDisconnectedAt      ISO | null
connectedNow            bool  (Hinweis: Wahrheit ist das SessionRegistry, nicht der Reducer; der Reducer bildet nur die Ereignisfolge ab)
agentVersion            string | null
maxOfflineSeconds       number | null
lastApplied             { version, correlationId, stale, files, templates, traefikCheck?, appliedAt } | null
lastApplyError          { version, correlationId, reason, appliedAt } | null
```

`version` eines Snapshots = `sequenceNumber` des `snapshot_published`-Ereignisses. Der Reducer sieht es über `event.sequenceNumber`.

### Invarianten

- Höchstens **zwei** Tokens mit `revokedAt == null` (FR-003). Das Ausstellen eines dritten ist ungültig.
- `tokenHash` ist SHA-256 (hex) eines 32-Byte-Zufallstokens. Der Klartext wird nie gespeichert.
- `connectionMode` ist nach `created` unveränderlich.
- Der Name ist je Konto eindeutig (Groß-/Kleinschreibung ignoriert), wie bei Credential-Labels.
- `snapshot_published` wird nur angehängt, wenn `contentHash != lastPublished.contentHash`.
- Ein gelöschter Provider akzeptiert keine weiteren Ereignisse.

### Zustandsübergänge der Anzeige (abgeleitet, nicht gespeichert)

```text
nie_verbunden ──agent_connected──▶ verbunden ──agent_disconnected──▶ getrennt
                                      ▲                                │
                                      └────────── agent_connected ─────┤
                                                                       └─(länger als maxOfflineSeconds)─▶ veraltet
```

## Aktion `traefik_config_delivery`

Erweitert das bestehende Aggregat `action` (keine neuen Ereignisse, kein neuer Reducer-Zweig).

```text
action.type            "traefik_config_delivery"
action.config          { traefikProviderId: string, group: string }
action.addressFamilies ["ipv4", "ipv6"]   (beide immer geliefert; der Wert bleibt aus Kompatibilität gesetzt)
```

### Validierung (Attach und Reconfigure)

- `traefikProviderId` verweist auf einen aktiven Provider **desselben Kontos**, sonst `404 traefik_provider_not_found` (FR-004; keine Auskunft über fremde IDs).
- `group` entspricht `^[a-z0-9][a-z0-9._-]{0,62}$` (1–63 Zeichen), sonst `422 invalid_group`.
- Je Gerät und Provider ist höchstens **eine** nicht entfernte Aktion erlaubt (`409 delivery_action_exists`), ein Gerät kann aber bei mehreren Providern vorkommen (FR-011).
- Provider- oder Gruppenwechsel plant Neuberechnung für alten und neuen Provider.

## Abgeleitet: Snapshot

Reine Funktion `buildSnapshot(accountId, providerId)`:

```text
für jede Aktion des Kontos mit
    type == traefik_config_delivery  und  status == enabled  und  config.traefikProviderId == providerId
  gehört zu Gerät G = action.ipClientId
  nur wenn G.status == enabled und G hat mindestens eine bekannte IP   (FR-012, FR-013)
  Eintrag { name: G.label (leer → ipClientId), ips: [lastKnownIPv4?, lastKnownIPv6?] } in Gruppe action.config.group
Gruppen nach Schlüssel sortiert, Einträge nach Name (dann ID), IPs sortiert.
contentHash = SHA-256 über die kanonische JSON-Darstellung (ohne Version, Zeit, Korrelations-ID).
```

Ein Gerät erscheint je Provider höchstens einmal (eine Aktion je Gerät und Provider, FR-011); über mehrere Provider kann es in mehreren Snapshots stehen. Der Gerätename kommt aus dem Feld `label` des Gerätezustands (nicht eindeutig; bei leerem Wert die `ipClientId`); Leerzeichen am Rand werden entfernt.

**Größenlimit**: Die serialisierte Größe (Protobuf) darf `BACKEND_AGENT_SNAPSHOT_MAX_BYTES` (Standard 1 048 576) nicht überschreiten, sonst `snapshot_publish_failed { reason: "too_large" }`. Der Agent behält dann seinen letzten Stand.

## Flüchtiger Zustand (nicht im Ereignisspeicher)

| Was | Wo | Hinweis |
|---|---|---|
| aktive Sitzungen | `SessionRegistry` im Prozess | Verloren beim Neustart, Agents verbinden neu |
| Fehlversuchszähler | Redis `agentauth:ip:<ip>`, `agentauth:prov:<id>` mit Ablauf | Schutz, keine Geschäftsentscheidung |
| Zusammenfassen von Neuberechnungen | BullMQ-Job `snap-<providerId>` | |
| Agent: Health-Datei | Dateisystem des Agents | Nicht notwendig für Korrektheit |

## Beziehungen

```text
Account 1───* traefik_provider 1───* Token (in den Ereignissen)
Account 1───* action(type=traefik_config_delivery) *───1 traefik_provider
action *───1 ip_client (Gerät)
traefik_provider 1───0..1 aktive Sitzung (Registry)
```

## Löschregeln

- Provider löschen: blockiert mit `409 traefik_provider_in_use` und `usedBy[{actionId, ipClientId, group}]`, solange nicht entfernte Aktionen darauf zeigen (FR-006). Ohne Aktionen: `deleted` anhängen, laufende Sitzung mit `UNAUTHENTICATED` beenden, Agent behält seine Dateien (sie bleiben unverändert, bis die Offline-Dauer abläuft).
- Konto schließen: `deleteAccount` löscht die Ereignisse; zuvor beendet `AccountClosureService` alle Sitzungen des Kontos.
