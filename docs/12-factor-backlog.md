# 12-Factor-Backlog

Stand: 2026-10-29. Ergebnis eines Audits der Anwendung gegen die [12-Factor-App](https://12factor.net/de/)-Kriterien. Die Zeilenangaben beziehen sich auf den Stand `1f60e58` und können sich verschieben.

Aufwand: grobe Schätzung für eine Person inkl. Tests und Doku (S ≤ 0,5 Tag, M ≈ 1–2 Tage, L ≈ 3–5 Tage, XL > 1 Woche, T = Tag). Prio und Aufwand zusammen bestimmen die Reihenfolge; Quick Wins sind 11 und 12.

## Abweichungen

| # | Faktor | Ist-Zustand (Beleg) | Soll | Prio | Aufwand |
|---|---|---|---|---|---|
| 1 | **XI Logs** | Access-Log in rotierende Datei `logs/access.log` mit eigener Rotation, `mkdirSync` zur Laufzeit, Volume `access-log-data` (`backend/src/observability/logging.ts:24,31-38`, `config/env.ts:111-113`, `docker-compose.yml:74`) | Alle Logs als Event-Strom nach stdout (eigene Kategorie/Feld für Access); Datei, Rotation, Volume und die drei Env-Variablen entfernen | Hoch | S–M (0,5–1 T) |
| 2 | **XII Admin-Prozesse** (auch IX) | Migrationen laufen bei jedem Start des Webprozesses (`main.ts:35`, `adapters/event-store-postgres/migrate.ts:12-41`), ohne Advisory Lock: parallele Instanzen können kollidieren. Kein `migrate`-Script, kein Schritt in der Pipeline | Migration als One-off-Kommando (z. B. `pnpm migrate`, Init-Container/Release-Schritt) oder mindestens `pg_advisory_lock` | Hoch | M (1–2 T); nur Advisory Lock: S |
| 3 | **V Build/Release/Run** (auch X) | Tests und Smoke-Tests im Release-Workflow auskommentiert (`.github/workflows/release.yml:65-66,93-161`), Kommentare behaupten weiter, sie liefen. Workflows triggern nur auf Push nach `main` (`release.yml:3-5`), kein CI auf Pull Requests | Tests/Smoke-Tests wieder aktivieren, PR-Workflow ergänzen, `pnpm -r build` außerhalb Docker entfernen (doppelte Arbeit, `release.yml:63`) | Hoch | M (1–2 T) |
| 4 | **VI Prozesse** / **VIII Nebenläufigkeit** | Agent-Sessions in prozesslokaler Map (`adapters/agent-grpc/session-registry.ts:16`), Coalescing/Resync-Timer lokal (`snapshot-coordinator.ts:27-28,91-105`), `KeyedMutex` prozesslokal (`domain/traefik-provider/keyed-mutex.ts:3`). README:138 nennt es bewusst „single instance“. Bei mehreren Replikas erreicht ein Snapshot-Push nur Agents der eigenen Instanz | Fan-out über Redis Pub/Sub oder Sticky Routing; Resync per BullMQ Repeatable Job oder Lock. Wenn bewusst Single-Instance: als Einschränkung dokumentieren | Hoch (falls Skalierung geplant), sonst Mittel | XL (> 1 Wo.); nur Doku der Einschränkung: S |
| 5 | **VIII Nebenläufigkeit** | Eine Prozessart für alles: HTTP, gRPC, zwei BullMQ-Worker und Resync-Timer starten in `main.ts:57-99`. Es gibt keinen getrennten `worker`-Prozesstyp | Rollen per Env/Argument trennen (`web`, `worker`, `agent-gateway`), selbes Image, getrennt skalierbar | Mittel | M (ca. 2 T) |
| 6 | **IX Einwegigkeit** | Shutdown unvollständig (`main.ts:103-113`): HTTP-Server aus `serve()` wird nicht geschlossen (Requests werden von `process.exit(0)` abgebrochen), Redis-Verbindung und beide Queues nicht geschlossen, kein Gesamt-Timeout, kein Schutz gegen zweites Signal, kein `.catch`, immer Exit-Code 0. Keine `unhandledRejection`/`uncaughtException`-Handler, kein `error`-Listener am Postgres-Pool (`main.ts:34`) | `server.close()`, `queue.close()`/`redis.quit()`, Timeout (z. B. 10 s), Reentrancy-Guard, Exit-Code bei Fehler, globale Handler | Mittel | M (ca. 1 T) |
| 9 | **III Konfiguration** (IV) | Stille Dev-Defaults statt Pflichtwert: SMTP `localhost:1025`, Absender `fluxip@localhost` (`config/env.ts:104,105,109`); Logto-App-ID/Secret und Management-Credentials leer erlaubt (`env.ts:98` ff.). Fehler zeigen sich erst beim Mailversand bzw. Login | In Prod Pflicht (oder Feature explizit abschalten), früh beim Start validieren | Mittel | S–M (0,5–1 T) |
| 10 | **III Konfiguration** / **VI** | Frontend-Container schreibt beim Start `dist/config.js` und überschreibt `dist/index.html` (`frontend/scripts/generate-runtime-config.mjs:49,53`): Root-FS muss beschreibbar sein; Cache-Buster `__CONFIG_VERSION__` wird nur beim ersten Start ersetzt, bei Container-Neustart mit geänderter Config kann eine alte `config.js` gecacht bleiben | `config.js` dynamisch ausliefern (oder in tmpfs-Pfad schreiben) mit Cache-Header/Hash statt Platzhalter-Ersetzung in `index.html` | Mittel | M (1–2 T) |
| 11 | **III Konfiguration** | Hartkodiert: Hetzner-API-Basis-URL (`hetzner-dns-executor.ts:15`, `hetzner-firewall-client.ts:6`) nicht überschreibbar (erschwert Mock-Tests); Frontend-Port 3000 im Compose-Command (`docker-compose.yml:80`); Agent-Port 8081 im Compose doppelt gepflegt (`docker-compose.yml:72`) | Per Env überschreibbar machen (Default beibehalten) | Niedrig | S (ca. 0,5 T) |
| 12 | **III Konfiguration** | Frontend mischt `window.__ENV__` und `VITE_*` (`frontend/src/config.ts`) | Config-Pfade vereinheitlichen | Niedrig | S (ca. 0,5 T) |
| 13 | **II Abhängigkeiten** | Ungepinnt: `logto:latest` (`docker-compose.yml:30`), `venatum/bull-board` ohne Tag (`:45`), `golang:1.25` ohne Patch (`agent/Dockerfile:3`); GitHub Actions per `@vN` statt SHA; `^`-Ranges in `package.json` (durch Lockfile abgesichert); `proto/` wird zur Laufzeit per Dateisystempfad gesucht (`grpc-agent-server.ts:47-54`) | Tags/Digests pinnen, Actions per SHA, Proto-Pfad im Image fest einbauen | Niedrig | M (ca. 1 T) |
| 14 | **X Dev/Prod-Parität** | Dev-Compose baut lokal und nutzt `latest`-Images, kein Prod-Compose/Deploy-Doku im Repo außer Traefik-Beispiel; Unit-Tests nutzen `InMemoryEventStore` (üblich, weicht bei Constraints/Transaktionen ab); Frontend-Config in Dev (`VITE_*`) ≠ Prod (`window.__ENV__`); Integrationstests teilen Redis mit produktionsnamigen Queues | Prod-Deployment dokumentieren, Test-Queue-Präfix, Images pinnen | Niedrig | M (1–2 T) |
| 16 | **VII Port-Binding** | gRPC ohne TLS (`createInsecure()`, `grpc-agent-server.ts`), setzt Reverse-Proxy voraus; XFF-Auswertung inkonsistent: gRPC letztes Element (`:126-133`), Access-Log erstes (`access-log.ts:18`) | TLS-Annahme dokumentieren, XFF-Auswertung vereinheitlichen (Trusted-Proxy-Konzept) | Niedrig | S–M (0,5–1 T) |

## Bereits konform

| Faktor | Befund |
|---|---|
| I Codebasis | Ein Monorepo, ein Image für Backend+Frontend, Rolle über Start-Command |
| II Abhängigkeiten | `pnpm-lock.yaml` mit `--frozen-lockfile`, `packageManager`/`engines`/Node-Image gepinnt |
| III Konfiguration | Zentral in `config/env.ts`, Pflichtwerte brechen den Start ab, `.env` ignoriert und nicht in der Git-Historie, Frontend-Runtime-Config |
| IV Backing Services | Postgres, Redis, SMTP, Logto, Agent über URLs/Env austauschbar |
| V Build/Release/Run | Multi-Stage-Dockerfile, unveränderliche Versions-Tags, semantic-release |
| VI Prozesse | Zustand in Postgres-Event-Store/Redis, JWT statt Server-Sessions, BullMQ-Deduplication, Redis-Locks |
| VII Port-Binding | Selbstexportierend (Hono, gRPC), Ports per Env |
| IX Einwegigkeit | SIGTERM/SIGINT behandelt, gRPC-Drain, Worker-Close, idempotente Jobs mit Retries, `exec` im Entrypoint |
| XI Logs | App-Log als JSON auf stdout, Redaction, kein `console.log` im Backend |

## Hinweise

- Nicht geprüft: Inhalt von `deploy/traefik/agents-router.example.yml`, Go-Agent-Code im Detail.
- Erledigte Punkte bitte hier entfernen oder abhaken, damit der Backlog aktuell bleibt.
