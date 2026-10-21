---

description: "Task list for Verteilung dynamischer Traefik-Konfiguration an Agents"
---

# Tasks: Verteilung dynamischer Traefik-Konfiguration an Agents

**Input**: Design documents from `/specs/008-traefik-provider-config/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (alle vorhanden)

**Tests**: Enthalten. plan.md legt Testarten und Orte fest (Vitest unter `backend/tests/{unit,contract,integration}`, `go test` im Agent, Playwright im Frontend) und quickstart.md §9 verlangt sie. Die Testaufgaben sind deshalb echte Lieferumfänge.

**Organization**: Aufgaben sind nach User Story gruppiert (spec.md: US1–US5 P1, US6–US7 P2, US8–US9 P3). Pfade sind relativ zum Repository-Root.

**Commits**: Keine Aufgabe enthält einen Commit. Commits entstehen nur auf ausdrückliche Anweisung (Constitution, Prinzip I).

**Annahmen dieser Task-Liste**: Sie folgt spec.md und plan.md in ihrem aktuellen Stand. FR-011 ist entschieden: höchstens eine Aktion je Gerät und Provider, eine Gruppe je Aktion. `schedule` trägt die auslösende Ereignis-ID (Korrelations-ID).

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Dateien, keine Abhängigkeit von offenen Aufgaben)
- **[Story]**: zugehörige User Story (US1 … US9)

## Path Conventions

- Backend: `backend/src/`, Tests `backend/tests/{unit,contract,integration}/`
- Frontend: `frontend/src/`, Tests `frontend/tests/`
- Agent: `agent/` (Go-Modul), Tests als `*_test.go` neben dem Code
- Protokoll: `proto/fluxip/agent/v1/session.proto`

---

## Phase 1: Setup

**Purpose**: Gerüst für Protokoll, Abhängigkeiten, Konfiguration, Agent-Modul

- [X] T001 Lege `proto/fluxip/agent/v1/session.proto` gemäß contracts/agent-session.proto.md an (Dienst `AgentSession`, `Envelope`, `Hello`, `Snapshot`, `Group`, `Entry`, `Report`, `FileSum`, `TraefikCheck`, `Heartbeat`, `SyncRequest`, `Bye`)
- [X] T002 [P] Füge `@grpc/grpc-js` und `@grpc/proto-loader` zu `backend/package.json` hinzu und aktualisiere `pnpm-lock.yaml`
- [X] T003 [P] Initialisiere das Go-Modul `agent/go.mod` mit Verzeichnissen aus plan.md (`cmd/fluxip-agent`, `internal/{config,session,render,apply,traefikcheck,health,templates}`), Abhängigkeiten `google.golang.org/grpc`, `gopkg.in/yaml.v3`, `github.com/pelletier/go-toml/v2`, `github.com/fsnotify/fsnotify`
- [X] T004 [P] Erzeuge Go-Code aus der `.proto` mit `agent/generate.sh` nach `agent/internal/pb/` (Skript dokumentiert die benötigten `protoc`-Plugins)
- [X] T005 [P] Ergänze `backend/src/config/env.ts` um `agentPort` (`BACKEND_AGENT_PORT`, Standard 8081), `agentPublicUrl` (`BACKEND_AGENT_PUBLIC_URL`, Pflicht für die Adressanzeige), `agentSnapshotMaxBytes` (`BACKEND_AGENT_SNAPSHOT_MAX_BYTES`, Standard 1048576), `agentSnapshotCoalesceMs` (Standard 1000), `agentResyncMs` (Standard 900000), `agentHeartbeatSeconds` (Standard 30) und dokumentiere sie in `.env.example`
- [X] T006 Passe `Dockerfile` an: `proto/` ins Runtime-Image kopieren; Pfad zur `.proto` im Backend relativ zu `backend/dist` auflösbar machen. Ergänze `docker-compose.yml` um die Freigabe von Port 8081 am Dienst `app`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Domänenbausteine, die jede User Story braucht

**⚠️ CRITICAL**: Keine User Story vor Abschluss dieser Phase

### Backend

- [X] T007 [P] Lege `backend/src/domain/traefik-provider/events.ts` an: `TRAEFIK_PROVIDER_AGGREGATE_TYPE`, Ereignisnamen und Datentypen gemäß data-model.md
- [X] T008 [P] Implementiere `backend/src/domain/traefik-provider/token.ts`: Erzeugen (`fxt_` + 32 Byte base64url), SHA-256-Hash, `last4`, zeitkonstanter Vergleich. Test in `backend/tests/unit/domain/traefik-provider/token.test.ts`
- [X] T009 [P] Erweitere `backend/src/domain/action/events.ts` um `TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE`, `TraefikConfigDeliveryConfig { traefikProviderId, group }` und die `ActionConfig`-Union. Grenze die Union dort ein, wo `config.providerCredentialId` gelesen wird: `backend/src/adapters/http/routes/provider-credentials.ts`, `backend/src/adapters/queue-bullmq/action-execution-worker.ts`, `backend/src/adapters/http/routes/actions.ts`
- [X] T010 Implementiere `backend/src/domain/traefik-provider/traefik-provider-aggregate.ts` (Reducer und `TraefikProviderState` gemäß data-model.md, Version aus `event.sequenceNumber`). Test in `backend/tests/unit/domain/traefik-provider/traefik-provider-aggregate.test.ts` (höchstens zwei gültige Tokens, Zustandsfolgen, `lastPublished`/`lastApplied`)
- [X] T011 Implementiere `backend/src/domain/traefik-provider/provider-store.ts`: Laden per Replay, Anhängen mit `KeyedMutex` je `providerId` und einmaligem Neuladen bei `ConcurrencyError`, `findProviderAccount` über `resolveAccountId`, Auflisten je Konto
- [X] T012 [P] Implementiere `backend/src/domain/traefik-provider/snapshot.ts`: `buildSnapshot(eventStore, accountId, providerId)` (aktive Aktionen des Typs, nur aktive Geräte mit bekannter IP, Zusammenführen je Gerät, deterministische Sortierung) und `contentHash` (kanonisches JSON, SHA-256). Test in `backend/tests/unit/domain/traefik-provider/snapshot.test.ts` (leer, mehrere Geräte pro Gruppe, Gerät in zwei Gruppen, Gerät ohne IP, deaktiviertes Gerät, doppelte Aktion → ein Eintrag, IPv4 und IPv6)
- [X] T013 [P] Lege den Port `backend/src/domain/traefik-provider/agent-channel.ts` an (`send(envelope)`, `close(reason)`, `onClose`, Metadaten `sessionId`, `tokenId`)
- [X] T014 [P] Implementiere `backend/src/adapters/agent-grpc/session-registry.ts`: `providerId → Sitzung`, `register` (liefert verdrängte Sitzung), `push`, `terminateByToken`, `terminateByProvider`, `terminateByAccount`, `isConnected`. Test in `backend/tests/unit/adapters/agent-grpc/session-registry.test.ts`
- [X] T015 Implementiere `backend/src/adapters/queue-bullmq/snapshot-publisher.ts` (Kern `publishNow(accountId, providerId)`): Snapshot bauen, Hash mit `lastPublished` vergleichen, bei Änderung `snapshot_published` anhängen (Version = Sequenznummer), Größenlimit prüfen (`snapshot_publish_failed{too_large}`), Ergebnis zurückgeben. Test in `backend/tests/unit/adapters/queue-bullmq/snapshot-publisher.test.ts`

### Agent (Go)

- [X] T016 [P] Implementiere `agent/internal/render/`: Datenmodell (`Provider`, `Version`, `Time`, `Stale`, `Groups`), Funktionen `cidr`, `cidrs`, `ipv4`, `ipv6`, `join`, `quote`, `group`, `first`, `default`, leere Liste für fehlende Gruppen, Ausgabename aus `<name>.<ext>.tmpl` und Präfix. Tests `agent/internal/render/render_test.go`
- [X] T017 [P] Implementiere `agent/internal/apply/`: Validierung je Endung (YAML, TOML), Alles-oder-nichts-Vorbereitung, atomares Schreiben (`.<name>.<zufall>.tmp`, `fsync`, `rename`, Verzeichnis-`fsync`), nur bei geändertem Inhalt, Präfix-Regel (nur `<prefix>*.{yml,yaml,toml}` verwalten, Verwaiste nach Erfolg entfernen), Prüfsummen. Tests `agent/internal/apply/apply_test.go`
- [X] T018 [P] Implementiere `agent/internal/config/` (Umgebungsvariablen und Parameter aus contracts/agent-cli.md, Startvalidierung mit Exit-Codes 2 und 3). Test `agent/internal/config/config_test.go`

**Checkpoint**: Domäne, Snapshot-Kern, Registry und Agent-Pipeline stehen.

---

## Phase 3: User Story 1 – Provider-Konfiguration anlegen und Agent in Betrieb nehmen (Priority: P1) 🎯 MVP

**Goal**: Provider anlegen, Token und Startbefehl erhalten, Agent verbindet, bekommt einen (leeren) Snapshot und rendert.

**Independent Test**: quickstart.md §1 (Provider anlegen, Agent starten, Zielverzeichnis prüfen, falsches Token wird abgelehnt).

### Tests (US1)

- [X] T019 [P] [US1] Contract-Test `backend/tests/contract/traefik-providers.test.ts`: `POST` (201 mit einmaligem Token, Adresse und `setup`), `GET`, `PATCH`, `409 name_in_use`, Isolation zwischen Konten (404 für fremde IDs)
- [X] T020 [P] [US1] Unit-Test `backend/tests/unit/domain/traefik-provider/agent-session-handler.test.ts` mit Fake-Kanal: Hello-Aushandlung, `FAILED_PRECONDITION` bei nicht unterstützter Version, Nachricht vor Hello, erster Snapshot unmittelbar nach Hello (auch leer), Report wird als `snapshot_applied`/`snapshot_apply_failed` festgehalten, Heartbeat-Timeout
- [X] T021 [P] [US1] Integrationstest `backend/tests/integration/agent-session.test.ts`: echter gRPC-Client gegen den Testserver, falsches Token → `UNAUTHENTICATED` mit immer gleicher Meldung, zwei Provider im selben Konto erhalten keine fremden Daten
- [X] T022 [P] [US1] Agent-Test `agent/internal/session/session_test.go` gegen einen In-Process-gRPC-Server: Hello, Snapshot empfangen, Report senden, `UNAUTHENTICATED` führt zu verständlicher Meldung ohne Dateischreiben

### Implementation (US1)

- [X] T023 [US1] Implementiere `backend/src/domain/traefik-provider/agent-session-handler.ts` (richtungsunabhängig, arbeitet gegen `AgentChannel`): Hello-Austausch und Versionsaushandlung, Aufruf von `publishNow` für den ersten Snapshot, Report-Verarbeitung mit Ereignissen, `agent_connected`/`agent_disconnected`, Heartbeat und `SyncRequest`, `Bye`
- [X] T024 [US1] Implementiere `backend/src/adapters/agent-grpc/grpc-agent-server.ts`: Laden der `.proto` (proto-loader), h2c-Listener auf `agentPort`, Authentifizierung (`authorization`, `x-fluxip-provider`, `resolveAccountId`, Token-Hash prüfen), Nachrichtenlimit und Keepalive, Adapter von gRPC-Stream auf `AgentChannel`, Validierung eingehender Nachrichten an der Grenze
- [X] T025 [US1] Implementiere `backend/src/adapters/http/routes/traefik-providers.ts` (`POST`, `GET` Liste und Einzel, `PATCH`) gemäß contracts/management-api.md inklusive `agentAddress`, `setup.startCommand`, `setup.traefikSnippet` und Hinweis auf Namenskonflikte; Zustandsableitung `nie_verbunden`/`verbunden`/`getrennt` aus Registry und Ereignissen
- [X] T026 [US1] Verdrahte in `backend/src/adapters/http/app.ts` die Route `/traefik-providers` und in `backend/src/main.ts` Publisher, Registry, gRPC-Server und geordnetes Herunterfahren (Server schließen, Sitzungen mit `UNAVAILABLE` beenden)
- [X] T027 [P] [US1] Implementiere `agent/internal/session/` (gRPC-Client, Header, Hello, Empfangsschleife, Report-Versand, Heartbeats, Backoff 1 s bis 60 s mit ±20 % Zufall; `UNAUTHENTICATED` als dauerhaft mit Wiederholung alle 5 Minuten)
- [X] T028 [US1] Implementiere `agent/cmd/fluxip-agent/main.go` (`run`, `version`) und `agent/internal/health/` (flüchtige Statusdatei): Start, Verbinden, Snapshot rendern und anwenden, Report mit Prüfsummen und Version
- [X] T029 [P] [US1] Frontend: `frontend/src/pages/TraefikProviders.tsx` (Liste mit Zustand, letzter Verbindung, angewendeter Version, Agent-Version), Route und Navigation, API-Funktionen in `frontend/src/services/api.ts`
- [X] T030 [P] [US1] Frontend: Anlege-Ablauf `frontend/src/flows/traefik-provider-wizard/` (Name; Verbindungsart "Agent verbindet zu FluxIP" vorausgewählt; Ergebnis mit einmaligem Token, Agent-Adresse, kopierbarem Startbefehl und Traefik-Beispiel; Hinweis zu Namenskonflikten mit manuell gepflegten Middlewares) auf Basis von `WizardShell`/`useWizard`

**Checkpoint**: US1 ist allein testbar: Agent verbindet, schreibt Dateien mit Fallback-Inhalt.

---

## Phase 4: User Story 2 – Geräteaktion mit einer Provider-Konfiguration verknüpfen (Priority: P1)

**Goal**: Am Gerät eine Aktion mit Provider und Gruppe anlegen, sodass der Eintrag im Snapshot erscheint.

**Independent Test**: Aktion anlegen, `buildSnapshot` bzw. der gesendete Snapshot enthält Gerätename und IPs.

### Tests (US2)

- [X] T031 [P] [US2] Contract-Test `backend/tests/contract/traefik-delivery-action.test.ts`: Anlegen mit Provider und Gruppe (201), `404 traefik_provider_not_found` auch für fremde Konten, `422 invalid_group`, manueller Lauf → `409 not_runnable`, Änderung und Entfernen
- [X] T032 [P] [US2] Frontend-Test `frontend/tests/traefik-delivery-step.test.tsx`: nur Provider des eigenen Kontos wählbar, bereits genutzte Gruppen werden vorgeschlagen

### Implementation (US2)

- [X] T033 [US2] Erweitere `backend/src/adapters/http/routes/actions.ts` um den Typ `traefik_config_delivery`: Validierung (Provider des Kontos aktiv, Gruppenformat `^[a-z0-9][a-z0-9._-]{0,62}$`), Anlegen, Ändern, Aktivieren, Deaktivieren, Entfernen, `addressFamilies` ignorieren
- [X] T034 [P] [US2] Lehne in `backend/src/adapters/http/routes/action-run.ts` den manuellen Lauf für den neuen Typ mit `409 not_runnable` ab und überspringe den Typ in `backend/src/adapters/queue-bullmq/execution-fanout-worker.ts`
- [X] T035 [P] [US2] Ergänze in `backend/src/adapters/http/routes/traefik-providers.ts` `GET /:id` mit `usedBy` und `groups` (Vorschläge für Gruppen)
- [X] T036 [P] [US2] Frontend: `frontend/src/flows/action-wizard/steps/TraefikDeliveryStep.tsx` (Provider wählen, Gruppe wählen oder neu eintippen mit Vorschlägen), Auswahl in `ChooseActionTypeStep.tsx`, Verdrahtung in `ActionWizard.tsx`, Anzeige der Aktion in `frontend/src/pages/Actions.tsx`

**Checkpoint**: Aktion lässt sich anlegen. Der Snapshot (T012/T015) enthält den Eintrag, sobald das Gerät eine IP hat.

---

## Phase 5: User Story 3 – IP-Änderung wird automatisch wirksam (Priority: P1)

**Goal**: IP-Änderung, Aktionsänderung und Geräteänderung führen zu einem zusammengefassten Snapshot nur an betroffene Agents.

**Independent Test**: quickstart.md §2.

### Tests (US3)

- [X] T037 [P] [US3] Integrationstest `backend/tests/integration/traefik-ip-change-pipeline.test.ts`: IP-Änderung → Snapshot mit neuer IP an verbundenen Agent; Änderung an Provider B erzeugt keinen Snapshot für Agent A; unveränderter Inhalt → kein `snapshot_published`; mehrere Änderungen in kurzer Folge → ein Snapshot mit Endzustand; periodischer Abgleich sendet erneut
- [X] T038 [P] [US3] Performance-Test `backend/tests/integration/traefik-delivery-latency.test.ts`: 95. Perzentil der Zeit von bestätigter IP-Änderung bis Snapshot beim Test-Agent ≤ 10 s über 20 Läufe (SC-001)
- [X] T039 [P] [US3] Agent-Test `agent/internal/session/ordering_test.go`: niedrigere Version wird ignoriert (`IGNORED_STALE`), gleiche Version idempotent, keine Datei bei unverändertem Ergebnis

### Implementation (US3)

- [X] T040 [US3] Erweitere `backend/src/adapters/queue-bullmq/queue.ts` um die Queue `traefik-snapshot` und implementiere in `snapshot-publisher.ts` `schedule(accountId, providerIds)` (Job-ID `snap-<providerId>`, Verzögerung `agentSnapshotCoalesceMs`) und den Worker, der `publishNow` ausführt und das Ergebnis über die Registry an die Sitzung pusht — umgesetzt als In-Prozess-Zusammenfassen (`SnapshotCoordinator`) statt BullMQ-Job, siehe research.md §4
- [X] T041 [US3] Rufe `schedule` auf: nach `ip_changed` in `backend/src/adapters/queue-bullmq/debounce-worker.ts` (Provider des Geräts über Replay der Aktionen), bei Aktionsänderungen in `backend/src/adapters/http/routes/actions.ts` (alter und neuer Provider bei Wechsel), bei Gerät aktivieren/deaktivieren/stilllegen in `backend/src/adapters/http/routes/ip-clients.ts`
- [X] T042 [US3] Periodischer Abgleich: Timer in `snapshot-publisher.ts` sendet alle `agentResyncMs` den aktuellen Snapshot an alle verbundenen Sitzungen, und der Handler beantwortet `SyncRequest` (T023)
- [X] T043 [P] [US3] Agent: Versionsprüfung und Idempotenz in `agent/internal/session/` bzw. `apply`: niedrigere Version ignorieren, nur bei geändertem Inhalt schreiben, Report mit passender `correlation_id`; strukturierte Logs mit `correlation_id` (`log/slog`, JSON)

**Checkpoint**: Der Hauptnutzen funktioniert Ende zu Ende.

---

## Phase 6: User Story 4 – Vorlagen für beliebige dynamische Konfiguration (Priority: P1)

**Goal**: Mitgelieferte Beispielvorlagen, sichere Behandlung leerer Gruppen und Fehler.

**Independent Test**: quickstart.md §3.

### Tests (US4)

- [X] T044 [P] [US4] Agent-Tests `agent/internal/templates/examples_test.go`: Allow-List bei gefüllter, leerer und veralteter Gruppe liefert gültiges YAML (nie leere `sourceRange`); Upstream-Beispiel rendert Server je Gerät; beide ohne Änderung des Codes nutzbar (SC-007)
- [X] T045 [P] [US4] Agent-Tests `agent/internal/apply/allornothing_test.go`: eine ungültige Vorlage unter mehreren → keine Datei verändert, Fehler im Report; Fremddateien ohne Präfix werden nie gelesen, geändert oder gelöscht; entfernte Vorlage entfernt ihre Datei nach Erfolg; Absturz-Simulation hinterlässt nur `.tmp`
- [X] T046 [P] [US4] Agent-Tests für die Start-Regeln in `agent/cmd/fluxip-agent/start_test.go`: fehlendes oder leeres Vorlagenverzeichnis und nicht beschreibbares Zielverzeichnis beenden den Start mit eindeutiger Meldung

### Implementation (US4)

- [X] T047 [P] [US4] Lege `agent/internal/templates/examples/allowlist.yml.tmpl` und `upstream.yml.tmpl` gemäß contracts/agent-cli.md an und binde sie per `//go:embed` ein
- [X] T048 [US4] Implementiere die Kommandos `templates` (`--list`, `--write DIR`, Ausgabe einzelner Vorlagen) und `check` (Trockenlauf mit leerem Snapshot) in `agent/cmd/fluxip-agent/main.go`
- [X] T049 [US4] Setze die Start-Regeln um (Exit-Codes 2 und 3) in `agent/cmd/fluxip-agent/main.go` und `agent/internal/config/`
- [X] T050 [US4] Fehlerbericht: Rendern/Validieren-Fehler werden als `RESULT_ERROR` mit Grund gemeldet und vom Backend als `snapshot_apply_failed` festgehalten (Abgleich mit T023)

**Checkpoint**: Vorlagen sind sicher und generisch nutzbar.

---

## Phase 7: User Story 5 – Betrieb bei Ausfall und Neustart (Priority: P1)

**Goal**: Traefik bleibt funktionsfähig bei Ausfall und Neustart, "veraltet" greift ohne Abhängigkeit von der Systemuhr.

**Independent Test**: quickstart.md §4.

### Tests (US5)

- [X] T051 [P] [US5] Agent-Test `agent/internal/session/offline_test.go` mit Fake-Uhr: Offline-Timer läuft monoton und unabhängig von der Wanduhr, `never` deaktiviert ihn
- [X] T052 [P] [US5] Agent-Test `agent/internal/session/backoff_test.go`: Abstand wächst exponentiell bis 60 s mit Zufallsanteil
- [X] T053 [P] [US5] Agent-Tests `agent/cmd/fluxip-agent/restart_test.go`: Neustart ohne FluxIP mit vorhandenen Dateien lässt sie unverändert; ohne Dateien wird mit leeren Gruppen gerendert
- [X] T054 [P] [US5] Integrationstest `backend/tests/integration/traefik-reconnect.test.ts`: Neustart des Servers, Agent verbindet neu und erhält den vollständigen Stand ohne Zutun

### Implementation (US5)

- [X] T055 [US5] Agent: Offline-Timer mit monotoner Uhr in `agent/internal/session/`, nach Ablauf erneutes Rendern mit `.Stale = true`; Rückkehr zu normalem Rendern beim nächsten gültigen Snapshot
- [X] T056 [US5] Agent: Startverhalten (FR-050) in `agent/cmd/fluxip-agent/main.go`: vorhandene Dateien bleiben, bis ein gültiger Snapshot eintrifft; ohne Dateien mit Präfix einmal mit leeren Gruppen rendern
- [X] T057 [P] [US5] Agent: `health`-Kommando in `agent/cmd/fluxip-agent/main.go` und `agent/internal/health/` (Exit 0 bei verbunden oder innerhalb der Offline-Höchstdauer, sonst 1)
- [X] T058 [US5] Backend: `max_offline_seconds` aus dem Hello in `agent_connected` festhalten und die Anzeige `veraltet` (Trennung länger als dieser Wert) in `backend/src/adapters/http/routes/traefik-providers.ts` ableiten

**Checkpoint**: SC-003 und SC-004 sind testbar.

---

## Phase 8: User Story 6 – Status und Rückmeldung einsehen (Priority: P2)

**Goal**: Zustand je Provider, Lieferstatus je Aktion, Fehlergründe, optionale Traefik-Prüfung.

**Independent Test**: quickstart.md §8 Schritt 5 und die UI-Anzeige nach Trennen/Verbinden.

### Tests (US6)

- [X] T059 [P] [US6] Contract-Test `backend/tests/contract/delivery-status.test.ts`: `GET /api/ip-clients/:id/delivery-status` liefert `applied`, `pending`, `error`, `agent_disconnected` gemäß research.md §12
- [X] T060 [P] [US6] Agent-Test `agent/internal/traefikcheck/check_test.go` gegen einen Fake-Traefik: erwartete Objekte geladen, fehlend, nicht erreichbar

### Implementation (US6)

- [X] T061 [US6] Implementiere `GET /api/ip-clients/:ipClientId/delivery-status` in `backend/src/adapters/http/routes/traefik-providers.ts` (oder eigener Route-Datei) mit der Ableitung aus research.md §12. Der Status landet **nicht** in der Redis-Aktionsprojektion
- [X] T062 [US6] Erweitere `GET /api/traefik-providers` um `lastError`, `appliedVersion`, `publishedVersion`, `agentVersion`, `notices`
- [X] T063 [P] [US6] Implementiere `agent/internal/traefikcheck/` (Abfrage der Traefik-API mit Wiederholung bis 10 s, erwartete Objekte aus `# fluxip:expect`-Zeilen) und füge das Ergebnis in den Report ein (`FLUXIP_TRAEFIK_API`)
- [X] T064 [P] [US6] Frontend: Statusanzeige in `frontend/src/pages/TraefikProviders.tsx` (Zustand, Fehlergrund) und Lieferstatus je Aktion in `frontend/src/pages/Actions.tsx` bzw. den Gerätedetails

---

## Phase 9: User Story 7 – Zugangsdaten und Lebenszyklus verwalten (Priority: P2)

**Goal**: Zwei Tokens, sofortiger Widerruf, Löschen mit Blockade, Schutz vor Missbrauch, Verdrängung.

**Independent Test**: quickstart.md §5 und §6.

### Tests (US7)

- [X] T065 [P] [US7] Contract-Test `backend/tests/contract/traefik-provider-tokens.test.ts`: zweites Token, `409 token_limit_reached`, Widerruf (idempotent), `409 traefik_provider_in_use` mit `usedBy`, Löschen ohne Aktionen
- [X] T066 [P] [US7] Integrationstest `backend/tests/integration/traefik-token-lifecycle.test.ts`: Widerruf beendet laufende Sitzung binnen 1 s, neue Verbindungen werden abgelehnt; Provider-Löschung beendet Sitzung; zweiter Agent mit demselben Token verdrängt den ersten (`Bye{superseded}`, Hinweis `previous_session_superseded`)
- [X] T067 [P] [US7] Unit-Test `backend/tests/unit/adapters/agent-grpc/auth-throttle.test.ts`: mehr als 10 Fehlversuche in 5 Minuten sperren die Quelle, andere Quellen bleiben unberührt

### Implementation (US7)

- [X] T068 [US7] Implementiere `POST /:id/tokens` und `DELETE /:id/tokens/:tokenId` in `backend/src/adapters/http/routes/traefik-providers.ts` mit `terminateByToken`
- [X] T069 [US7] Implementiere `DELETE /:id` mit `usedBy`-Prüfung (`409 traefik_provider_in_use`), `deleted`-Ereignis und `terminateByProvider`
- [X] T070 [P] [US7] Implementiere `backend/src/adapters/agent-grpc/auth-throttle.ts` (Redis `INCR`/`EXPIRE` je Quell-IP und je `providerId`, `x-forwarded-for` des letzten vertrauenswürdigen Glieds) und binde ihn in `grpc-agent-server.ts` ein; stelle sicher, dass `authorization` in Logs redigiert wird
- [X] T071 [US7] Verdrängung: `agent_connected{replacedPrevious}` und `notices` in der API; in `backend/src/domain/account/account-closure-service.ts` `terminateByAccount` vor dem Löschen der Ereignisse aufrufen
- [X] T072 [P] [US7] Frontend: Tokenverwaltung und Löschdialog mit Auflistung der verwendenden Aktionen in `frontend/src/pages/TraefikProviders.tsx` bzw. Unterkomponenten

---

## Phase 10: User Story 8 – Verbindungsart vorsehen (Priority: P3)

**Goal**: Variante B ist in Datenmodell, Protokoll und UI vorgesehen, aber nicht wählbar.

**Independent Test**: quickstart.md §7.

### Tests (US8)

- [X] T073 [P] [US8] Ergänze `backend/tests/contract/traefik-providers.test.ts` um `422 connection_mode_not_available` für `server_initiated` und `422 immutable_field` bei Änderung der Verbindungsart
- [X] T074 [P] [US8] Architektur-Test `backend/tests/unit/domain/traefik-provider/channel-independence.test.ts`: `agent-session-handler.ts` importiert nichts aus `adapters/agent-grpc/` und läuft vollständig gegen den Fake-Kanal (Absicherung von SC-008)

### Implementation (US8)

- [X] T075 [US8] Validierung der Verbindungsart in `backend/src/adapters/http/routes/traefik-providers.ts` und Unveränderlichkeit nach `created`
- [X] T076 [P] [US8] Frontend: Auswahl der Verbindungsart im Anlege-Ablauf mit "FluxIP verbindet zum Agent" als deaktivierte Option mit Kennzeichnung "noch nicht verfügbar" (`frontend/src/flows/traefik-provider-wizard/`)

---

## Phase 11: User Story 9 – Vorlagen im Betrieb ändern (Priority: P3)

**Goal**: Der Agent übernimmt geänderte Vorlagen nur, wenn sie mit letztem und leerem Snapshot funktionieren.

**Independent Test**: quickstart.md §3 (SIGHUP mit ungültiger Vorlage).

### Tests (US9)

- [X] T077 [P] [US9] Agent-Test `agent/internal/render/reload_test.go`: gültige Änderung wird übernommen und angewendet; ungültige (Fehler im Normal- oder im Leerfall) wird abgelehnt, bisherige Menge bleibt, Fehler wird gemeldet

### Implementation (US9)

- [X] T078 [US9] Implementiere in `agent/internal/render/` bzw. `agent/cmd/fluxip-agent/main.go` das Neuladen per `fsnotify` (mit Entprellung) und `SIGHUP`, Probelauf mit letztem und leerem Snapshot, Ersetzen der aktiven Menge nur bei Erfolg, Fehlerbericht an FluxIP

---

## Phase 12: Polish & Cross-Cutting Concerns

- [X] T079 [P] Lege `.github/workflows/agent-release.yml` an: Auslöser bei Änderungen unter `agent/**` und `proto/**`, eigene Version über semantic-release mit Tag-Format `agent-v${version}` (Konfiguration `agent/.releaserc.json`, Pfadfilter), Bau für `linux/amd64` und `linux/arm64` (`CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`), Größenprüfung < 30 MB, Upload von Binaries und `SHA256SUMS` als Release-Assets; prüfe, dass `release.yml` und `.github/scripts/determine-version.mjs` von `agent-v*`-Tags unberührt bleiben — Workflow und Versionsskript geschrieben und lokal geprüft; ein echter Lauf in GitHub Actions steht aus
- [X] T080 [P] Optional: `agent/Dockerfile` (`FROM scratch`, Binary, CA-Zertifikate, `HEALTHCHECK`) und Multi-Arch-Push nach GHCR im Agent-Workflow
- [X] T081 [P] Ende-zu-Ende-Test `agent/e2e_test.go` (`TestE2E`): echter Agent-Prozess gegen In-Process-Server, Messung von Leerlauf-RAM < 50 MB (SC-005) und Snapshot-Anwendung mit Korrelations-ID im Agent-Log (SC-006)
- [ ] T082 [P] Frontend-Ende-zu-Ende-Erweiterung in der bestehenden Playwright-Suite: Provider anlegen → Aktion am Gerät anlegen → Status sichtbar — Spezifikation `frontend/tests/e2e/traefik-provider.spec.ts` geschrieben; läuft wie die übrigen E2E-Tests nur mit angemeldeter Sitzung (README in `frontend/tests/e2e/`), hier nicht ausgeführt
- [X] T083 [P] Dokumentation: Abschnitt in `README.md` zu Agent-Betrieb (Adresse, Token, Vorlagen, Präfix-Regel, Namenskonflikte), zur Einschränkung "eine Backend-Instanz" (research.md §6) und zum Weiterreichen von h2c durch den vorgeschalteten Traefik (Beispiel-Router in `docker-compose.yml` bzw. `deploy/`)
- [ ] T084 Führe quickstart.md §1–§10 gegen eine echte Umgebung aus und trage die Ergebnisse der Annahmen aus research.md §16 (h2c und Timeouts hinter Traefik, Fallback bei leerer Allow-List, `.tmp`-Dateien, `x-forwarded-for`, Tag-Formate) in research.md nach — teilweise erledigt: Annahmen aus research.md §16 gegen Traefik v3.3 und den echten Agent geprüft; die UI-Schritte des Quickstarts (Anmeldung nötig) stehen aus
- [X] T085 [P] `pnpm --filter fluxip-backend lint`, `pnpm --filter fluxip-frontend lint`, `go vet ./...` und `gofmt` im Agent; behebe Befunde — Backend-`src`, Frontend, `go vet` und `gofmt` sauber; `pnpm --filter fluxip-backend lint` meldet schon auf `main` Parserfehler für alle Testdateien (nicht in der tsconfig), unabhängig von diesem Feature
- [ ] T086 Bestätige mit dem Auftraggeber die Namen aus research.md §15 und übernimm Abweichungen konsistent in Code, Dokumenten und UI-Texten

---

## Dependencies & Execution Order

### Phase-Abhängigkeiten

- **Setup (P1)** → **Foundational (P2)** → User Stories → **Polish**
- Foundational blockiert alle Stories.

### Story-Abhängigkeiten

- **US1** (MVP-Kern) baut nur auf Foundational auf.
- **US2** baut auf Foundational auf. Der Gesamtnutzen mit **US1** zusammen.
- **US3** braucht US1 (Sitzung) und US2 (Aktion), liefert den Hauptnutzen.
- **US4** baut auf Foundational (Agent-Pipeline) auf und ist von US1–US3 unabhängig testbar. Zusammen mit US1 entsteht der erste lauffähige Durchstich.
- **US5** baut auf US1 und der Agent-Pipeline auf.
- **US6** braucht US1 und US3 (Berichte, Versionen).
- **US7** baut auf US1 auf (Tokens, Registry).
- **US8** ist nach US1 unabhängig.
- **US9** braucht die Agent-Pipeline (Foundational) und US4.

### Innerhalb der Stories

- Tests zuerst schreiben und rot sehen, dann implementieren.
- Domäne vor Adapter, Adapter vor Verdrahtung (`main.ts`, `app.ts`).

## Parallel Execution Examples

```text
Foundational (nach Setup):
  Backend:  T007 ∥ T008 ∥ T009 ∥ T012 ∥ T013 ∥ T014      → danach T010, T011 → T015
  Agent:    T016 ∥ T017 ∥ T018

US1:
  Tests:    T019 ∥ T020 ∥ T021 ∥ T022
  Umsetzung: T023 → T024 → T025 → T026 (Backend, nacheinander)
             T027 ∥ T029 ∥ T030 (Agent-Session und Frontend parallel dazu), danach T028

US4 und US5 (Agent) können parallel zu US2/US3 (Backend) laufen, da sie andere Dateien betreffen.
```

## Implementation Strategy

**MVP**: Setup → Foundational → **US1 + US2 + US3 + US4** (alle P1, liefern zusammen "IP-Änderung landet als gültige Datei bei Traefik"). US1 allein ist bereits unabhängig lauffähig (Agent verbindet, schreibt Fallback-Dateien). **US5** gehört ebenfalls zu P1 und sollte vor dem ersten produktiven Einsatz fertig sein (SC-003, SC-004).

**Inkrementell**:
1. Setup + Foundational.
2. US1 → prüfen (quickstart §1).
3. US2 + US3 → prüfen (§2), SC-001 messen.
4. US4 + US5 → prüfen (§3, §4), SC-003/SC-004.
5. US6, US7 (P2), dann US8, US9 (P3).
6. Polish, Release-Pipeline, Echtumgebung (T084).

**Risiken zuerst abklären**: T084-Punkt "gRPC hinter Traefik" (h2c, Leerlauf-Timeouts) sollte früh mit einem Spike nach T024/T027 geprüft werden, weil davon die Transportentscheidung abhängt (research.md §7, §16).
