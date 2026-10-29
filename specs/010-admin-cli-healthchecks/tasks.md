---

description: "Task list for Admin-CLI und Healthchecks"
---

# Tasks: Admin-CLI und Healthchecks

**Input**: Design documents from `/specs/010-admin-cli-healthchecks/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli.md, contracts/compose-health.md, quickstart.md (alle vorhanden)

**Tests**: Enthalten. plan.md legt Testarten fest (Vitest unter `backend/tests/{unit,integration}`, Integrationstests gegen echtes Postgres und Redis laut CLAUDE.md), research.md §8 beschreibt sie. Das Compose-Verhalten wird manuell geprüft (quickstart.md §4).

**Organization**: Aufgaben sind nach User Story gruppiert (spec.md: US1 P1, US2 P1, US3 P2). Pfade sind relativ zum Repository-Root.

**Commits**: Keine Aufgabe enthält einen Commit. Commits entstehen nur auf ausdrückliche Anweisung (Constitution, Prinzip I).

**Annahmen dieser Task-Liste**: Sie folgt spec.md und plan.md in ihrem aktuellen Stand. `BACKEND_LOGTO_APP_ID/_SECRET` werden nicht geprüft (FR-009). Der Verschlüsselungsschlüssel wird nur in `checkConfig` streng geprüft, nicht in `loadConfig` (die Tests nutzen den Platzhalter `unused`, `backend/tests/helpers/test-config.ts`).

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Dateien, keine Abhängigkeit von offenen Aufgaben)
- **[Story]**: zugehörige User Story (US1 … US3)

## Path Conventions

- Backend: `backend/src/`, Tests `backend/tests/{unit,integration}/`
- Compose und Doku im Repository-Root (`docker-compose.yml`, `docs/`)
- Keine Änderung an `Dockerfile`, `docker-entrypoint.sh`, `agent/`, `proto/`, `frontend/`.

---

## Phase 1: Setup

Entfällt. Es gibt keine neuen Abhängigkeiten und keine neue Konfiguration.

---

## Phase 2: Foundational

**Purpose**: Das gemeinsame Gerüst der CLI (Befehlstabelle, Exit-Codes, Hilfe), das US1 und US2 brauchen.

- [X] T001 Ergänze in `backend/package.json` das Script `"cli": "tsx src/cli.ts"`.
- [X] T002 [P] Schreibe `backend/tests/unit/cli.test.ts` gegen `runCli(argv, io)`: `help`, `--help`, `-h` und kein Argument zeigen die Hilfe aus contracts/cli.md und enden mit `0`. Ein unbekannter Befehl und eine unbekannte Option zeigen die Hilfe auf stderr und enden mit `2`. Die Hilfe funktioniert ohne jede Umgebungsvariable (die Befehlsmodule werden dabei nicht geladen).
- [X] T003 Lege `backend/src/cli.ts` an: Befehlstabelle mit `migrate` und `validate-config`, Argumente über `node:util` `parseArgs`, Konstanten `EXIT_OK = 0`, `EXIT_ERROR = 1`, `EXIT_USAGE = 2`, exportierte Funktion `runCli(argv, io)` mit injizierbarem `stdout`/`stderr`, Befehlsmodule per dynamischem Import aus `backend/src/cli/<befehl>-command.ts`. Beim direkten Aufruf (`node backend/dist/cli.js`) ruft die Datei `runCli(process.argv.slice(2))` auf und beendet mit dem Rückgabecode. Ausgabe nur auf stdout/stderr, keine Logger-Konfiguration, keine Datei (research.md §1, §6).

**Checkpoint**: `pnpm --filter fluxip-backend cli help` funktioniert, T002 ist grün.

---

## Phase 3: User Story 1 - Migrationen als eigener Schritt ausführen (Priority: P1) 🎯 MVP

**Goal**: `migrate` bringt die Datenbank ohne App-Start auf den aktuellen Stand, sicher bei gleichzeitigen Aufrufen. Der Webprozess migriert nicht mehr, sondern prüft den Stand. Das Compose führt die Migration als eigenen Schritt aus (spec.md FR-001 bis FR-006).

**Independent Test**: Frische Datenbank, `migrate` ausführen (Schema vollständig, kein Server gestartet), zweimal gleichzeitig ausführen (jede Migration genau einmal), App gegen veraltetes Schema starten (Abbruch mit Hinweis) (quickstart.md §2, §3).

### Tests für User Story 1

- [X] T004 [P] [US1] Schreibe `backend/tests/integration/migrate-cli.test.ts` gegen eine frisch angelegte Wegwerf-Datenbank (per `CREATE DATABASE` über die Haupt-Verbindung, danach löschen, damit andere Tests unberührt bleiben): `runMigrations` zweimal gleichzeitig auf leerer Datenbank → beide fertig, jede Datei genau einmal in `schema_migrations` (SC-001). Erneuter Lauf → leere Rückgabeliste. Eine fehlerhafte Migration (eigenes temporäres Migrationsverzeichnis über den optionalen Parameter) → Fehler, kein Eintrag, frühere bleiben (FR-004). Der Befehl über `runCli(["migrate"])` mit gesetzter `BACKEND_DATABASE_URL`: Ausgabe `applied …` und `N migration(s) applied`, dann `up to date`, Exit `0`. Ohne `BACKEND_DATABASE_URL` Exit `1` mit Namen der Variable. Nicht erreichbare Datenbank → Exit `1`, Ausgabe ohne Zugangsdaten. Nach `runCli(["migrate"])` lauscht kein Prozess auf `BACKEND_PORT` oder `BACKEND_AGENT_PORT`, und im Arbeitsverzeichnis ist keine neue Datei entstanden (FR-019, SC-002).
- [X] T005 [P] [US1] Schreibe `backend/tests/integration/schema-check.test.ts` für `assertSchemaCurrent`: Datenbank ohne `schema_migrations` → `SchemaOutdatedError` mit allen Dateien. Teilweise migriert → nennt nur die ausstehenden. Aktuell → kein Fehler. Eintrag ohne Datei in `schema_migrations` → kein Fehler. Die Fehlermeldung enthält `node backend/dist/cli.js migrate`. Die Funktion ändert die Datenbank nicht (keine neue Tabelle, keine Einträge).

### Implementierung für User Story 1

- [X] T006 [US1] Ändere `backend/src/adapters/event-store-postgres/migrate.ts`: `runMigrations(pool, migrationsDir = <bisheriges Verzeichnis>)` hält `pg_advisory_lock(hashtext('fluxip:migrate'))` auf einer eigenen Verbindung für den ganzen Lauf (Tabelle anlegen, Stand lesen, Dateien anwenden), gibt die Sperre in `finally` frei und liefert die Liste der angewendeten Dateinamen zurück (bisher `void`, Aufrufer bleiben kompatibel). Neue exportierte Funktion `assertSchemaCurrent(pool, migrationsDir?)` und Klasse `SchemaOutdatedError` (Meldung "Database schema is outdated: N pending migration(s) (<namen>). Run: node backend/dist/cli.js migrate"). `assertSchemaCurrent` liest nur und legt nichts an (research.md §2, §3).
- [X] T007 [US1] Lege `backend/src/cli/migrate-command.ts` an: liest nur `BACKEND_DATABASE_URL` aus der Umgebung (kein `loadConfig`), ruft `runMigrations`, gibt je angewendeter Datei `applied <name>` und `N migration(s) applied` bzw. `up to date` aus, bei Fehler auf stderr `migration <name> failed: <ursache>` mit Exit `1` (Ursache ohne Verbindungsadresse mit Zugangsdaten), schließt den Pool immer (contracts/cli.md).
- [X] T008 [US1] Ändere `backend/src/main.ts`: ersetze den Aufruf `runMigrations(pool)` durch `assertSchemaCurrent(pool)`. Bei veraltetem Schema bricht der Start über den vorhandenen Fatal-Handler mit Exit `1` ab (kein Schreiben in die Datenbank).
- [X] T009 [US1] Ändere `docker-compose.yml`: neuer Dienst `migrate` (gleiches `build` wie `app`, `command: ["node", "backend/dist/cli.js", "migrate"]`, `env_file: .env`, `restart: "no"`, `depends_on` `postgres` healthy). `app` bekommt `depends_on: migrate: condition: service_completed_successfully` zusätzlich zu den bestehenden Abhängigkeiten (contracts/compose-health.md).

**Checkpoint**: US1 ist eigenständig nutzbar und testbar (MVP). Konfigurationsprüfung und Healthchecks fehlen noch.

---

## Phase 4: User Story 2 - Konfiguration vor dem Deploy prüfen (Priority: P1)

**Goal**: `validate-config` meldet alle Konfigurationsprobleme in einem Lauf, nie einen Wert, optional mit Erreichbarkeitsprüfung (spec.md FR-007 bis FR-012).

**Independent Test**: Eine Konfiguration mit mehreren fehlenden Werten, einer ungültigen Zahl und einem falschen Schlüssel prüfen: alle Probleme erscheinen in einem Lauf, kein Geheimnis in der Ausgabe, Exit `1`. Mit `--online` je Dienst `ok` oder `FAIL` (quickstart.md §2).

### Tests für User Story 2

- [X] T010 [P] [US2] Schreibe `backend/tests/unit/config/env.test.ts`: `loadConfig` mit mehreren fehlenden Pflichtwerten wirft eine `ConfigError`, die alle nennt. Die Meldung zu einer ungültigen Zahl nennt den Variablennamen, aber nicht den Rohwert. Bestehende Standardwerte und der Rückgabewert für eine gültige Umgebung bleiben unverändert (z. B. `testConfig()` aus `backend/tests/helpers/test-config.ts` mit dem Schlüssel `unused`).
- [X] T011 [P] [US2] Schreibe `backend/tests/unit/config/check.test.ts` für `checkConfig(env)`: jede Zeile der Tabelle aus research.md §4 (Pflichtwert fehlt oder leer → Fehler, Zahl nicht ganzzahlig oder Port außerhalb 1–65535, Boolean ungleich `true`/`false`, URL ungültig oder falsches Schema, Schlüssel nicht Base64 mit 32 Byte, Log-Level ungültig; SMTP-Host leer oder `localhost`, Absender leer oder `@localhost`, Management-Werte teilweise oder ganz fehlend, Agent-Adresse leer → Warnung mit Funktionshinweis). Alle Probleme erscheinen in einem Ergebnis. Ein vorgegebener Geheimniswert (Schlüssel, SMTP-Passwort, URL mit Passwort) kommt in keiner `name`-/`reason`-Zeichenkette vor. `BACKEND_LOGTO_APP_ID/_SECRET` erzeugen keinen Befund. Drift-Schutz: Ein Test liest über einen `Proxy` auf der Umgebung mit, welche Variablen `loadConfig` abfragt, und prüft, dass jede davon in `KNOWN_VARS` steht und umgekehrt keine unbekannte Variable darin steht.
- [X] T012 [P] [US2] Schreibe `backend/tests/integration/validate-config-cli.test.ts` über `runCli(["validate-config", …])`: gültige Umgebung → `configuration ok`, Exit `0`. Mit Warnungen → Exit `0`. Mit Fehlern → Exit `1` und alle Fehlerzeilen. `--online` gegen laufendes Postgres und Redis → `ok postgres`, `ok redis`. Nicht erreichbarer Port → `FAIL` mit Fehlercode, Ausgabe ohne Zugangsdaten. Logto über einen lokalen Test-HTTP-Server: `200` mit `keys` → `ok logto`, `502` → `FAIL logto: HTTP 502`, hängende Antwort → `FAIL logto: timeout` nach der Frist, ohne dass die anderen Prüfungen verzögert werden. Unbekannte Option → Exit `2`.

### Implementierung für User Story 2

- [X] T013 [US2] Ändere `backend/src/config/env.ts`: `requireString`, `optionalInt`, `optionalBool` sammeln Probleme in einer Liste statt sofort zu werfen. `loadConfig` wirft am Ende eine exportierte `ConfigError` mit allen Problemen (erste Zeile bleibt `Missing required environment variable: <NAME>` bzw. `Environment variable <NAME> must be an integer`, ohne Rohwert). Rückgabewert und Standardwerte bleiben unverändert. Exportiere die Hilfsfunktionen so, dass `checkConfig` dieselben nutzt (research.md §4).
- [X] T014 [US2] Lege `backend/src/config/check.ts` an: `checkConfig(env)` liefert Konfigurationsbefunde (`name`, `level` `error`|`warning`, `reason`, bei Warnungen `feature`) nach der Tabelle in research.md §4 und data-model.md. Gibt nie einen Wert aus. Prüft `BACKEND_LOGTO_APP_ID/_SECRET` nicht. Exportiert ein Register `KNOWN_VARS` aller Variablen, die `loadConfig` liest (einschließlich `FLUXIP_VERSION`), jeweils mit Stufe oder dem Vermerk "nicht geprüft" (z. B. `BACKEND_LOGTO_APP_ID/_SECRET`).
- [X] T015 [P] [US2] Lege `backend/src/cli/online-checks.ts` an: `checkPostgres(url)` (Verbindung mit Frist, `SELECT 1`), `checkRedis(url)` (ohne Wiederholversuche, `PING`), `checkLogto(endpoint)` (`GET <endpoint>/oidc/jwks`, erwartet 200 mit `keys`), je Frist 5 s, parallel über `Promise.allSettled`. Ergebnis `{ service, ok, reason }`, `reason` ist Fehlercode, `HTTP <status>` oder `timeout`, nie Adresse mit Zugangsdaten und nie eine rohe Treibermeldung (research.md §5).
- [X] T016 [US2] Lege `backend/src/cli/validate-config-command.ts` an: Option `--online`, ruft `checkConfig(process.env)`, gibt `ERROR <name>: <reason>` und `WARN  <name>: <reason> (<feature> will not work)` aus, dann die Zusammenfassung (`configuration ok` bzw. `N error(s), M warning(s)`). Mit `--online` und ohne Konfigurationsfehler bei den Adressen anschließend `ok`/`FAIL` je Dienst aus `online-checks.ts`. Exit `1` bei mindestens einem Fehler oder `FAIL`, sonst `0`. Format wie contracts/cli.md.

**Checkpoint**: US1 und US2 funktionieren unabhängig voneinander.

---

## Phase 5: User Story 3 - Gesundheitszustand im Compose sehen (Priority: P2)

**Goal**: `app` und `frontend` melden ihren Zustand, `frontend` startet erst, wenn `app` gesund ist (spec.md FR-013 bis FR-016).

**Independent Test**: Compose starten, beide Dienste werden `healthy`. Postgres stoppen, `app` wird `unhealthy`, nach dem Start wieder `healthy` (quickstart.md §4).

### Implementierung für User Story 3

- [X] T017 [US3] Ändere `docker-compose.yml`: Healthcheck für `app` (`CMD-SHELL`, `wget -q -O /dev/null http://127.0.0.1:$${BACKEND_PORT:-8080}/readyz`), Healthcheck für `frontend` (`wget -q -O /dev/null http://127.0.0.1:3000/`), je `interval: 10s`, `timeout: 5s`, `retries: 4`, `start_period: 20s`. `frontend` bekommt `depends_on: app: condition: service_healthy` (statt der bisherigen einfachen Abhängigkeit). Kein `HEALTHCHECK` im Dockerfile (contracts/compose-health.md, research.md §7).
- [X] T018 [US3] Prüfe gegen das gebaute Image (research.md §9, quickstart.md §4): `docker compose up -d --build`, `docker compose ps` zeigt `migrate` beendet mit 0 sowie `app` und `frontend` `healthy`. Bei gestopptem Postgres liefert `docker compose exec app wget -q -O /dev/null http://127.0.0.1:8080/readyz; echo $?` einen Wert ungleich 0 und `app` wird `unhealthy`. `service_completed_successfully` wird akzeptiert, `serve` antwortet unter `/` mit 200. Weicht etwas ab, passe T017 an und halte es in research.md §9 fest.

- [X] T025 [US3] Beim Prüfen von T018 zeigte sich, dass das Backend beendet wird, sobald Postgres wegfällt (nicht abgefangenes `error`-Ereignis des Connection-Pools). Damit würde `app` nie "ungesund" und wieder "gesund" (Story 3, Szenario 2), sondern der Container stirbt. Lege `backend/src/adapters/event-store-postgres/pool.ts` mit `createPool(url)` an (hängt einen `error`-Handler an, der nur loggt), nutze es in `backend/src/main.ts` und sichere es mit `backend/tests/unit/adapters/pool.test.ts` ab.

**Checkpoint**: Alle drei Stories sind unabhängig nutzbar.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T019 [P] Aktualisiere die Dokumentation: `docs/configuration.md` (Verweis auf `validate-config`, die beiden `BACKEND_LOGTO_APP_*` als vom Backend nicht verwendet vermerken), `docs/development.md` und `README.md` (Befehle `cli migrate`, `cli validate-config`, Startreihenfolge `migrate` vor `pnpm dev:backend`, Migrationsschritt für Deployments außerhalb des Compose, Hinweis zur Sperre bei hängender Verbindung und zu `BACKEND_BIND_ADDRESS` im Healthcheck), `CLAUDE.md` (Befehlsliste um `pnpm --filter fluxip-backend cli …` ergänzen), `docs/release.md` (Abschnitt "One image, two runtime roles": vor dem `docker run … node backend/dist/main.js` den Schritt `docker run --env-file .env … node backend/dist/cli.js migrate` ergänzen und erklären, dass das Backend ohne Migration nicht mehr startet).
- [X] T020 [P] Aktualisiere `docs/12-factor-backlog.md`: Punkt 2 entfernen. Punkt 9 auf den Rest kürzen (stille Entwicklungswerte beim Start des Webprozesses, `BACKEND_LOGTO_APP_ID/_SECRET` vom Backend nicht gelesen) und die Beschreibung entsprechend anpassen. Bereits-konform-Tabelle um die erledigten Aspekte ergänzen (Admin-Prozesse), falls dort eine passende Zeile besteht (FR-018, SC-006). In Punkt 3 (Release-Workflow) vermerken, dass die auskommentierten Smoke-Tests nach dem Wiederaktivieren vorab `migrate` ausführen müssen.
- [X] T021 [P] Ergänze in `.env.example` einen Kommentar bei `BACKEND_LOGTO_APP_ID/_SECRET`, dass das Backend sie derzeit nicht verwendet.
- [X] T022 Führe `pnpm --filter fluxip-backend test`, `npx tsc --noEmit` und `npx eslint src` im Backend aus (Postgres und Redis laufen, Umgebung laut quickstart.md). Neue Fehler sind zu beheben. Die vier bekannten Fehler der Ausgangslage (`failure-diagnostics`, `review-retry-notify`, `operation-traceability`, `horizontal-scale`) sind getrennt zu benennen.
- [X] T023 Validiere quickstart.md §2 bis §4 von Hand: Hilfe und Exit-Codes, `migrate` leer, wiederholt und gleichzeitig, `validate-config` ohne Umgebung (alle Pflichtwerte genannt, Exit `1`), mit gesetztem Geheimniswert (nicht in der Ausgabe), `--online`, App gegen veraltetes Schema (Abbruch mit Hinweis).
- [X] T024 Bestätige per `git diff --stat`, dass `Dockerfile`, `docker-entrypoint.sh`, `agent/`, `proto/` und `frontend/` unverändert sind und dass `runMigrations` in `backend/src/` nur noch von `migrate.ts` und `cli/migrate-command.ts` aufgerufen wird (`grep -rn runMigrations backend/src`).

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 2 (Foundational): keine Abhängigkeit, blockiert US1 und US2 (Gerüst `cli.ts`).
- Phase 3 (US1) und Phase 4 (US2): beide nach Phase 2, voneinander unabhängig und parallel möglich (andere Dateien).
- Phase 5 (US3): nach T009, weil beide Aufgaben `docker-compose.yml` ändern (T017 nach T009). Sonst unabhängig.
- Phase 6 (Polish): nach den gewünschten Stories. T019 und T020 beschreiben das Endverhalten und folgen daher der Umsetzung.

### Within Each Story

- Tests zuerst schreiben, sie müssen fehlschlagen, bevor implementiert wird.
- US1: T006 vor T007 und T008 (beide nutzen die Funktionen), T009 unabhängig von T006 bis T008 in der Datei, aber vor T017.
- US2: T013 vor T014 (gemeinsame Hilfsfunktionen), T014 und T015 vor T016.

### Parallel Opportunities

- Phase 2: T002 parallel zu T001, danach T003.
- US1: T004 und T005 parallel. US2: T010, T011 und T012 parallel, T015 parallel zu T013/T014.
- US1 und US2 komplett parallel, wenn zwei Personen oder Agenten arbeiten (keine gemeinsamen Dateien außer `cli.ts` aus Phase 2).
- Polish: T019, T020 und T021 parallel.

### Parallel Example: User Story 2

```text
Task: "env.test.ts schreiben" (T010)
Task: "check.test.ts schreiben" (T011)
Task: "validate-config-cli.test.ts schreiben" (T012)
Task: "online-checks.ts anlegen" (T015, nach T003)
```

---

## Implementation Strategy

### MVP First (nur User Story 1)

1. Phase 2 abschließen (T001–T003).
2. US1 (T004–T009).
3. Prüfen: `migrate` wendet an, ist wiederholbar und bei gleichzeitigen Aufrufen sicher, die App bricht bei veraltetem Schema mit Hinweis ab. Das schließt Backlog Punkt 2.

### Incremental Delivery

1. US1 → Backlog 2 gelöst, sicherer Betrieb mit mehreren Instanzen möglich.
2. US2 → Konfigurationsfehler vor dem Deploy sichtbar (Backlog 9 teilweise).
3. US3 → Gesundheitszustand im Compose.
4. Polish → Doku und Backlog abgleichen.

### Hinweis zum Ausrollen

Nach T008 startet die App ohne vorherige Migration nicht mehr. Bevor T008 ausgeliefert wird, müssen T009 (Compose) und die Doku (T019) bereitstehen, sonst bricht ein bestehendes Deployment beim Update ab. Beides gehört in dieselbe Auslieferung.
