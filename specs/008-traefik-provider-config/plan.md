# Implementation Plan: Verteilung dynamischer Traefik-Konfiguration an Agents

**Branch**: `008-traefik-provider-config` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-traefik-provider-config/spec.md`, technical pre-decisions from [plan-input.md](./plan-input.md)

## Summary

FluxIP verteilt die aktuellen IPs von Geräten als **Snapshots** an **Agents** auf abgesetzten Systemen. Ein Agent (Go, ein statisches Binary) rendert lokale Vorlagen und schreibt die Ergebnisse atomar in Traefiks File-Provider-Verzeichnis.

Es gibt drei Neuerungen im Backend:

1. **Ein neues Aggregat `traefik_provider`** (Provider-Konfiguration). Es hält Name, Verbindungsart, Token-Hashes, veröffentlichte Snapshot-Versionen und die Agent-Rückmeldungen. Es folgt dem Muster der Provider Credentials, aber mit eigener Struktur, weil die Tokens eingehend sind (Hash statt verschlüsseltes Geheimnis).
2. **Ein neuer Aktionstyp `traefik_config_delivery`** am Gerät mit `{ traefikProviderId, group }`. Er ist **kein** `ActionExecutor`. Er löst keine Ausführungen aus, sondern plant die Neuberechnung der betroffenen Provider (siehe research.md §2).
3. **Eine Agent-Sitzung über gRPC** auf eigenem HTTP/2-Port. Die Sitzungslogik (`AgentSessionHandler`) kennt nur einen abstrakten Kanal, nicht die Richtung des Verbindungsaufbaus. Variante A ist der eingehende gRPC-Adapter, Variante B wäre später ein ausgehender Adapter am selben Handler.

Das Snapshot-Versionsschema, die `.proto`-Definition, der Agent und das Frontend (Seite "Traefik-Provider", Anlege-Ablauf, Aktionsschritt, Statusanzeige) sind in research.md, data-model.md und contracts/ beschrieben.

## Technical Context

**Language/Version**: Backend TypeScript 5.7 auf Node.js 22 (bestehend). Frontend SolidJS + TypeScript (bestehend). **Neu**: Agent in Go (aktuelle stabile Version, `CGO_ENABLED=0`).

**Primary Dependencies**: Backend neu `@grpc/grpc-js` und `@grpc/proto-loader` (reines JS, keine nativen Module). Sonst bestehend: Hono, BullMQ, ioredis, pg, ulid, logtape. Agent: `google.golang.org/grpc`, `gopkg.in/yaml.v3`, `github.com/pelletier/go-toml/v2`, `github.com/fsnotify/fsnotify`, Standardbibliothek `text/template`, `log/slog` (JSON-Handler).

**Storage**: PostgreSQL-Ereignisspeicher (Quelle der Wahrheit, unverändert, keine Migration nötig, da `events` generisch ist). Redis nur flüchtig: Fehlversuchszähler gegen Brute-Force. Das Zusammenfassen von Auslösern läuft im Prozess (research.md §4). **Keine** neue Projektion für Snapshots in v1 (research.md §5). Der Agent hat keinen Speicher außer den geschriebenen Dateien und einer flüchtigen Health-Datei.

**Testing**: Backend Vitest (reine Funktionen: Snapshot-Bildung, Hash, Token-Prüfung; Handler mit Fake-Kanal; gRPC-Integrationstest mit echtem Client gegen Testserver; Testcontainers für Postgres/Redis wie bisher). Agent: `go test` (Renderer, Validierung, atomares Schreiben, Präfix-Regeln, Backoff, Offline-Timer mit Fake-Uhr) und ein Ende-zu-Ende-Test gegen einen In-Process-gRPC-Server. Frontend: Vitest-Komponententest für die neuen Schritte, eine Playwright-Erweiterung.

**Target Platform**: Backend Docker/Linux (bestehend). Agent: linux/amd64 und linux/arm64.

**Project Type**: Monorepo mit `backend/` und `frontend/` (pnpm). **Neu** `agent/` (Go-Modul, nicht Teil des pnpm-Workspace) und `proto/` (geteilte `.proto`).

**Performance Goals**: SC-001: 95 % der IP-Änderungen in ≤ 10 s ab bestätigter Änderung in den Dateien. Das Budget: Zusammenfassen 1 s + Snapshot-Bildung + Push + Rendern/Schreiben; reichlich im Rahmen.

**Constraints**: Agent-Binary < 30 MB, Leerlauf < 50 MB RAM (SC-005). Snapshot-Maximum: 1 MiB serialisiert (konfigurierbar, FR-024). Agent nur ausgehend (FR-041). Offline-Dauer per monotoner Uhr (FR-051).

**Scale/Scope**: Konto-Limit für Geräte ist standardmäßig 5; pro Konto wenige Provider (Größenordnung 1–10), je ein Agent. Daher reicht Neuberechnung per Replay ohne Projektion, und eine einzige Backend-Instanz mit In-Prozess-Sitzungsregister (research.md §6).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` (v1.0.0) enthält ein Prinzip: **I. Explizite Commit-Freigabe**. Das ist eine Prozessregel für den Assistenten. Weder dieser Plan noch die späteren Tasks dürfen automatische Commits vorsehen. Die Tasks bleiben ohne "Commit nach jeder Aufgabe".

Die de-facto-Leitplanken aus den Vorgängerfeatures (pragmatisch hexagonal, Port nur bei echter zweiter Implementierung, Ereignisspeicher als Wahrheit, Redis nie Entscheidungsquelle) werden so geprüft:

- **Port nur bei echter zweiter Implementierung**: Die Sitzungsgrenze (`AgentChannel`) wird eingeführt, obwohl heute nur Variante A existiert. Das ist eine explizite Vorgabe der Spezifikation (FR-031/FR-032, SC-008), keine Spekulation. Der Port ist klein (`send`, `close`, `onMessage`).
- **`ActionExecutor` bleibt unverändert**: Der neue Aktionstyp bildet keine Ausführung ab (Zustandsabgleich statt Einzelaufruf), siehe research.md §2.
- **Redis nie Entscheidungsquelle**: Die Veröffentlichung eines Snapshots (Versionsvergabe) ist eine Entscheidung und wird als Ereignis `snapshot_published` im Ereignisspeicher festgehalten. Nur das Zusammenfassen mehrerer Auslöser läuft über eine BullMQ-Verzögerung.
- **Neue Muster, bewusst und begrenzt**: (1) zweiter Netzwerk-Listener im Backend-Prozess (gRPC/h2c), (2) langlebige Verbindungen mit In-Prozess-Zustand, (3) ein zweites Release-Artefakt. Jedes ist direkt durch eine Spezifikationsanforderung begründet.

**Post-Phase-1 Re-Check**: data-model.md und contracts/ bestätigen: ein neues Aggregat, ein neuer Aktionstyp, kein neuer Port außer `AgentChannel`, keine neue Projektion. Offen bleibt die Annahme einer einzelnen Backend-Instanz; sie ist als Einschränkung dokumentiert (research.md §6), nicht als Verstoß. Keine Einträge in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/008-traefik-provider-config/
├── plan.md
├── plan-input.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── agent-session.proto.md      # Sitzungsprotokoll (Nachrichten, Ablauf, Fehlercodes)
│   ├── management-api.md           # REST-Endpunkte für UI (Provider, Token, Aktion, Status)
│   └── agent-cli.md                # Agent: Kommandos, Umgebungsvariablen, Vorlagenkonvention, Health
├── checklists/requirements.md
└── tasks.md                        # nicht Teil von /speckit-plan
```

### Source Code (repository root)

```text
proto/
└── fluxip/agent/v1/session.proto                # NEW — geteilt, Quelle für Backend (proto-loader) und Agent (protoc-gen-go)

backend/src/
├── domain/traefik-provider/
│   ├── events.ts                                # NEW — Aggregat + Ereignisse + Datentypen
│   ├── traefik-provider-aggregate.ts            # NEW — Reducer (Tokens, Veröffentlichung, Rückmeldungen, Präsenz-Ereignisse)
│   ├── snapshot.ts                              # NEW — reine Funktion: Aktionen+Geräte → Snapshot; kanonischer Hash
│   ├── token.ts                                 # NEW — Erzeugen, Hashen, zeitkonstanter Vergleich
│   ├── agent-session-handler.ts                 # NEW — Sitzungslogik, unabhängig von der Verbindungsrichtung
│   ├── agent-channel.ts                         # NEW — Port: send/close (Variante A heute, B später)
│   ├── agent-protocol.ts                        # NEW — transportneutrale Nachrichten, Versionsgrenzen, CloseReason
│   ├── provider-store.ts                        # NEW — Laden/Anhängen mit KeyedMutex und einmaligem Retry
│   ├── keyed-mutex.ts                           # NEW
│   ├── delivery-actions.ts                      # NEW — Aktionen eines Kontos, Provider eines Geräts
│   └── snapshot-scheduler.ts                    # NEW — Schnittstelle schedule(); Gruppenmuster
├── domain/action/
│   ├── events.ts                                # MODIFIED — TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE, TraefikConfigDeliveryConfig
│   └── action-aggregate.ts                      # MODIFIED — keine Reducer-Änderung nötig; Typ-Union erweitert
├── adapters/agent-grpc/
│   ├── grpc-agent-server.ts                     # NEW — eingehender Adapter (Variante A), h2c-Listener, Auth, Rate-Limit
│   ├── proto-codec.ts                           # NEW — Wire ↔ Domänennachrichten, Eingabevalidierung
│   ├── session-registry.ts                      # NEW — providerId → aktive Sitzung, Ersetzen/Beenden
│   ├── snapshot-coordinator.ts                  # NEW — fasst Auslöser zusammen, pusht geänderte Snapshots, periodischer Abgleich
│   └── auth-throttle.ts                         # NEW — Redis-Zähler je Quelle für fehlgeschlagene Authentifizierungen (FR-035)
├── adapters/queue-bullmq/
│   ├── snapshot-publisher.ts                    # NEW — berechnen, bei Änderung `snapshot_published` anhängen
│   ├── execution-fanout-worker.ts               # MODIFIED — überspringt den neuen Aktionstyp
│   └── debounce-worker.ts                       # MODIFIED — ruft schedule() nach ip_changed
├── adapters/http/routes/
│   ├── traefik-providers.ts                     # NEW — CRUD, Tokens, Status
│   ├── delivery-status.ts                       # NEW — Lieferstatus je Gerät (nicht in der Aktionsprojektion)
│   ├── actions.ts                               # MODIFIED — neuer Typ: Validierung, schedule() bei attach/reconfigure/enable/disable/detach
│   ├── action-run.ts                            # MODIFIED — manueller Lauf für den neuen Typ ablehnen
│   └── ip-clients.ts                            # MODIFIED — schedule() bei enable/disable/decommission
├── domain/account/account-closure-service.ts    # MODIFIED — Sitzungen des Kontos beenden
├── config/env.ts                                # MODIFIED — Agent-Port, öffentliche Agent-Basisadresse, Limits
└── main.ts                                      # MODIFIED — gRPC-Server und Publisher verdrahten, Shutdown

backend/test/ ...                                # neue Tests neben den bestehenden

agent/
├── go.mod
├── cmd/fluxip-agent/main.go                     # run | templates | health | version
├── internal/config/                             # Umgebung + Parameter
├── internal/session/                            # gRPC-Client, Backoff mit Jitter, Handler (spiegelt Backend-Handler)
├── internal/render/                             # text/template, Hilfsfunktionen, Datenmodell
├── internal/apply/                              # Validierung, atomares Schreiben, Präfix-Verwaltung, Alles-oder-nichts
├── internal/traefikcheck/                       # optionale Prüfung über Traefik-API
├── internal/health/                             # flüchtige Health-Datei
├── internal/templates/examples/*.tmpl           # //go:embed Beispielvorlagen
└── Dockerfile                                   # optional, minimales Image (scratch)

frontend/src/
├── pages/TraefikProviders.tsx                   # NEW — Liste + Status
├── flows/traefik-provider-wizard/               # NEW — Anlegen/Token/Startbefehl
├── flows/action-wizard/steps/TraefikDeliveryStep.tsx  # NEW — Provider + Gruppe
├── flows/action-wizard/steps/ChooseActionTypeStep.tsx # MODIFIED
└── services/api.ts                              # MODIFIED

.github/workflows/agent-release.yml              # NEW — getrennte Pipeline, Tags agent-vX.Y.Z
Dockerfile, docker-compose.yml                   # MODIFIED — Proto kopieren, Agent-Port
deploy/traefik/agents-router.example.yml         # NEW — Beispiel-Router mit h2c-Backend
agent/Dockerfile                                 # NEW — optionales scratch-Image
.github/scripts/determine-agent-version.mjs     # NEW — Version des Agents aus Conventional Commits auf agent/ und proto/
```

**Structure Decision**: Backend und Frontend folgen der bestehenden Aufteilung. Der Agent ist ein eigenständiges Go-Modul unter `agent/` (eigener Build, eigene Release-Linie). Geteilt wird nur `proto/`, kein Code.

## Complexity Tracking

Keine Verstöße. Die drei bewusst neuen Muster (zweiter Listener, langlebige Sitzungen, zweites Release-Artefakt) sind in der Constitution-Prüfung begründet.
