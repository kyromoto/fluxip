# Contract: Agent-Sitzungsprotokoll (v1)

Zielort der Definition: `proto/fluxip/agent/v1/session.proto` (wird bei der Umsetzung angelegt). Dieses Dokument legt Nachrichten, Ablauf und Fehlerverhalten fest.

## Dienst

```proto
syntax = "proto3";
package fluxip.agent.v1;

service AgentSession {
  // Beide Richtungen tragen denselben Nachrichtentyp. Variante A: Agent ruft auf.
  // Variante B (später): FluxIP ruft auf, der Agent implementiert denselben Dienst.
  rpc Session(stream Envelope) returns (stream Envelope);
}

message Envelope {
  oneof body {
    Hello      hello      = 1;
    Snapshot   snapshot   = 2;
    Report     report     = 3;
    Heartbeat  heartbeat  = 4;
    SyncRequest sync_request = 5;
    Bye        bye        = 6;
  }
}
```

Feldnummern sind stabil. Neue Felder sind additiv (SC-009). Unbekannte Felder und unbekannte `oneof`-Zweige werden ignoriert und nur geloggt.

## Nachrichten

```proto
message Hello {
  uint32 protocol_version      = 1;  // höchste unterstützte Version des Senders
  string agent_version         = 2;  // Agent -> FluxIP: SemVer; FluxIP -> Agent: Backend-Version
  uint32 max_offline_seconds   = 3;  // Agent -> FluxIP; 0 = nie
  uint32 heartbeat_seconds     = 4;  // FluxIP -> Agent: gewünschtes Intervall (Standard 30)
  uint32 max_snapshot_bytes    = 5;  // FluxIP -> Agent: Information
  string provider_name         = 6;  // FluxIP -> Agent
  uint32 accepted_version      = 7;  // FluxIP -> Agent: ausgehandelte Version
}

message Snapshot {
  uint64 version           = 1;  // = Sequenznummer von snapshot_published
  string correlation_id    = 2;
  string generated_at      = 3;  // RFC 3339, UTC
  string provider_name     = 4;
  repeated Group groups    = 5;  // vollständiger Stand, nie Delta
}

message Group {
  string key = 1;
  repeated Entry entries = 2;
}

message Entry {
  string device_name = 1;
  repeated string ips = 2;  // IPv4 und IPv6 gemischt, textuell
}

message Report {
  uint64 version                    = 1;
  string correlation_id             = 2;
  Result result                     = 3;
  string error                      = 4;   // nur bei RESULT_ERROR
  string agent_version              = 5;
  bool   stale                      = 6;
  repeated FileSum files            = 7;
  repeated FileSum templates        = 8;
  TraefikCheck traefik_check        = 9;   // optional
  enum Result {
    RESULT_UNSPECIFIED   = 0;
    RESULT_OK            = 1;
    RESULT_ERROR         = 2;
    RESULT_IGNORED_STALE = 3;  // Version <= zuletzt angewendete (FR-053)
  }
}

message FileSum { string name = 1; string sha256 = 2; }

message TraefikCheck {
  enum Status { STATUS_UNSPECIFIED = 0; STATUS_OK = 1; STATUS_MISSING = 2; STATUS_UNREACHABLE = 3; }
  Status status = 1;
  repeated string loaded  = 2;
  repeated string missing = 3;
}

message Heartbeat   { uint64 nonce = 1; }
message SyncRequest {}                    // Agent bittet um den aktuellen Snapshot
message Bye         { string reason = 1; }
```

## Ablauf (identisch für Variante A und B)

```text
Agent                                         FluxIP
  │── Hello{protocol_version, agent_version, max_offline_seconds} ─▶
  │                         ◀── Hello{accepted_version, heartbeat_seconds, max_snapshot_bytes, provider_name} ──
  │                         ◀── Snapshot{aktueller Stand, auch leer}  ──
  │── Report{version, result, files, templates} ─▶
  │                         ◀── Snapshot{…}   (bei jeder inhaltlichen Änderung, zusammengefasst)
  │── Report{…} ─▶
  │◀──────────── Heartbeat{n} ───────────── / ── Heartbeat{n} ─────────────▶   (beide Richtungen)
  │── SyncRequest ─▶     ◀── Snapshot{aktueller Stand}
  │◀── Bye{reason} / ── Bye{reason} ──▶    (kontrolliertes Ende)
```

Regeln:

1. **Hello zuerst**: Beide Seiten senden `Hello`, bevor sie etwas anderes senden. Nachrichten davor beenden die Sitzung mit `FAILED_PRECONDITION`.
2. **Versionsaushandlung (FR-036)**: `accepted_version = min(Agent.protocol_version, Backend.max)`. Liegt sie unter `Backend.min_supported`, antwortet FluxIP mit `FAILED_PRECONDITION` und der Meldung `protocol_version_unsupported: agent speaks vN, server supports vA..vB, update the agent`.
3. **Erster Snapshot** folgt unmittelbar auf das Hello von FluxIP, auch wenn er leer ist (US1-2).
4. **Periodischer Abgleich (FR-021)**: FluxIP sendet den aktuellen Snapshot alle 15 Minuten erneut (gleiche Version, wenn nichts passiert ist). Der Agent verarbeitet gleiche Version idempotent (Inhalt unverändert → keine Datei geschrieben, aber ein Report).
5. **Reihenfolge (FR-053)**: Der Agent ignoriert `Snapshot.version` kleiner als die zuletzt *angewendete* und antwortet mit `RESULT_IGNORED_STALE`. Gleiche Version wird erneut angewendet.
6. **Reports**: Pro Snapshot genau ein Report. FluxIP ordnet ihn über `version` und `correlation_id` zu. Berichte zu einer unbekannten oder künftigen Version werden geloggt und ignoriert.
7. **Heartbeat**: Jede Seite sendet im vereinbarten Intervall `Heartbeat`. Kommt 3 Intervalle lang nichts, beendet die empfangende Seite die Sitzung (FluxIP: `agent_disconnected{timeout}`; Agent: verbindet neu).
8. **Eine Sitzung je Provider (FR-034)**: Öffnet sich eine zweite, sendet FluxIP der ersten `Bye{reason: "superseded"}` und beendet sie. `agent_connected.replacedPrevious = true`.
9. **Snapshot zu groß (FR-024)**: FluxIP sendet nichts, hängt `snapshot_publish_failed{too_large}` an. Der Agent behält seinen Stand.

## Authentifizierung und Metadaten (Variante A)

| Metadatum | Pflicht | Inhalt |
|---|---|---|
| `authorization` | ja | `Bearer fxt_<token>` |
| `x-fluxip-provider` | ja | `providerId` aus der Agent-Adresse |
| `user-agent` | nein | z. B. `fluxip-agent/1.0.0` (nur Info) |

Prüfung vor dem ersten Nachrichtenaustausch. Fehlerabbildung:

| Situation | gRPC-Status | Meldung (für Menschen) |
|---|---|---|
| fehlendes oder falsches Token, unbekannte `providerId`, widerrufen, Provider gelöscht | `UNAUTHENTICATED` | `invalid or revoked token for this agent address` (immer gleich) |
| zu viele Fehlversuche von derselben Quelle | `RESOURCE_EXHAUSTED` | `too many failed attempts, retry later` |
| Protokollversion nicht unterstützt | `FAILED_PRECONDITION` | siehe Regel 2 |
| Backend fährt herunter | `UNAVAILABLE` | `server shutting down` |
| zweite Sitzung verdrängt diese | Ende mit `Bye{superseded}`, danach `ABORTED` | |
| Variante B (`server_initiated`) wird versucht | — | API lehnt Anlegen ab, keine Sitzung möglich |

Der Agent behandelt `UNAUTHENTICATED` als **dauerhaften** Fehler: Er schreibt keine Datei, loggt die verständliche Meldung, und wiederholt trotzdem sehr selten (alle 5 Minuten), damit ein später korrekt gesetztes Token ohne Neustart funktioniert. `UNAVAILABLE`/Netzwerkfehler sind vorübergehend (exponentieller Backoff 1 s … 60 s mit Zufallsanteil ±20 %).

## Größen und Grenzen

- `max_snapshot_bytes` Standard 1 MiB serialisiert. Nachrichtenlimit im Transport = dieser Wert + 64 KiB.
- Gruppenschlüssel ≤ 63 Zeichen, Gerätename ≤ 128 Zeichen (FluxIP kürzt beim Aufbau nicht, die API begrenzt die Eingabe).
- Heartbeat-Standard 30 s.

## Kompatibilität

- Innerhalb `v1` nur additive Änderungen (neue Felder, neue `oneof`-Zweige).
- Ein inkompatibler Bruch führt zu `v2` unter neuem Paketnamen `fluxip.agent.v2`. FluxIP bedient beide, solange `min_supported` es erlaubt.
- Test (SC-009): Ein Agent mit Protokoll v1 des vorherigen Releases bleibt Teil der Integrationsmatrix.
