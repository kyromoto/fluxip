# Research: Admin-CLI und Healthchecks

Alle Aussagen beziehen sich auf den Ist-Stand des Repos (2026-10-29). Es gibt keine offenen `NEEDS CLARIFICATION`. Punkte, die erst gegen das echte Image bestätigt werden können, stehen in §9.

## §1 Wo die CLI liegt und wie sie aufgerufen wird

**Ist-Stand**: Das Backend baut mit `tsc` nach `backend/dist/`. Das Image enthält `backend/dist` und startet das Backend per `node backend/dist/main.js`. `docker-entrypoint.sh` führt das übergebene Kommando unverändert aus (`exec "$@"`). Es gibt kein CLI.

**Entscheidung**: Neue Datei `backend/src/cli.ts`, gebaut nach `backend/dist/cli.js`. Aufruf im Container: `node backend/dist/cli.js <befehl>`, lokal: `pnpm --filter fluxip-backend cli <befehl>` (Script `"cli": "tsx src/cli.ts"`). Argumente über `node:util` `parseArgs`, keine neue Abhängigkeit. Befehle werden per dynamischem Import geladen, damit `--help` ohne Konfiguration und ohne Datenbankverbindung funktioniert.

**Begründung**: Dasselbe Image bedient Backend, Frontend und CLI. Das Dockerfile bleibt unverändert. Das Muster entspricht der paperfeed-CLI (Befehlstabelle, Exit-Codes, dynamische Importe), ohne deren Befehle zu übernehmen, die hier nicht gebraucht werden.

**Verworfen**: Eine CLI-Bibliothek (commander o. Ä.): Zwei Befehle rechtfertigen keine Abhängigkeit. Ein eigenes Binary: überflüssig, Node ist im Image.

## §2 Migration unter Advisory Lock

**Ist-Stand** (`adapters/event-store-postgres/migrate.ts`): `runMigrations(pool)` legt `schema_migrations` an, liest die `.sql`-Dateien sortiert und wendet nicht vermerkte in je einer Transaktion an. Es gibt keine Sperre. Zwei Prozesse können beide `CREATE TABLE IF NOT EXISTS` ausführen (Race im Katalog) oder dieselbe Datei gleichzeitig anwenden. Der zweite scheitert dann am Primärschlüssel von `schema_migrations`, nachdem er die Änderungen ausgeführt hat (nur durch das Rollback gerettet, bei nicht idempotentem SQL nicht).

**Entscheidung**: `runMigrations` hält für den gesamten Lauf eine Sitzungssperre `pg_advisory_lock(hashtext('fluxip:migrate'))` auf einer eigenen Verbindung. Alles (Tabelle anlegen, Stand lesen, Dateien anwenden) läuft darunter. Ein wartender Aufruf blockiert, bekommt danach die Sperre, liest den Stand neu und findet nichts zu tun. Die Sperre wird in `finally` freigegeben und fällt bei Verbindungsabbruch ohnehin weg. Die Funktion liefert die Liste der angewendeten Dateinamen zurück (bisher `void`, Aufrufer ignorieren den Wert, daher kompatibel).

**Begründung**: Sitzungssperren überstehen die Einzel-Transaktionen der Migrationen, und der Lock ist ohne neue Tabelle möglich. Die Signatur bleibt, damit die Integrationstests, die `runMigrations` in `beforeAll` aufrufen, unverändert laufen.

**Verworfen**: `pg_advisory_xact_lock` je Datei: schützt die `CREATE TABLE`-Race nicht und lässt den Stand zwischen den Dateien unbewacht. Eine Migrationsbibliothek (node-pg-migrate): ersetzt funktionierenden Code ohne Gewinn für diese Anforderung.

## §3 Schemaprüfung beim Start statt Migration (Clarification Q1)

**Entscheidung**: `main.ts` ruft nicht mehr `runMigrations`, sondern `assertSchemaCurrent(pool)`. Die Funktion liest `schema_migrations` (fehlt die Tabelle, gilt alles als ausstehend) und vergleicht mit den Dateien im Migrationsverzeichnis. Sind welche ausstehend, wirft sie `SchemaOutdatedError` mit der Meldung "Database schema is outdated: N pending migration(s) (<namen>). Run: node backend/dist/cli.js migrate". Der bestehende Fatal-Handler in `main.ts` schreibt sie nach stderr und beendet mit Exit-Code 1. Die Datenbank wird nicht verändert. Unbekannte Einträge in `schema_migrations` (Datenbank neuer als die App) sind kein Fehler.

**Folge für den Betrieb**: Wer die App ohne `migrate` startet, bekommt eine klare Meldung statt eines stillen Updates. Compose und Doku bekommen den Migrationsschritt (§7).

**Verworfen**: Weiter migrieren mit Lock (Option B der Clarification): löste die Kollision, ließe aber Faktor XII bestehen. Umschalter per Umgebungsvariable (Option C): zweiter Pfad zum Testen ohne Gewinn, denn das Compose macht den Komfort schon.

## §4 Konfiguration: alle Probleme sammeln, eine Quelle der Wahrheit

**Ist-Stand** (`config/env.ts`): `loadConfig` wirft beim ersten Problem. Die Hilfsfunktionen `requireString`, `optionalInt`, `optionalBool` kennen die Variablen. Die ganzzahlige Fehlermeldung gibt den Rohwert aus (`got: ${raw}`). Es gibt keine Format- oder Bereichsprüfung. `BACKEND_CREDENTIAL_ENCRYPTION_KEY` wird nur auf "nicht leer" geprüft. Die Tests setzen den Wert auf `"unused"`, `loadConfig` darf ihn also nicht strenger prüfen.

**Befund**: `logtoAppId` und `logtoAppSecret` werden im gesamten Backend nirgends gelesen. Die Token-Prüfung (`oidc-middleware.ts`) nutzt allein `logtoEndpoint` (JWKS unter `/oidc/jwks`, Issuer `<endpoint>/oidc`). Die Management-Werte werden nur in `logto-management-client.ts` genutzt, SMTP in `email-notifier.ts`. Daraus folgt die Anpassung der Spec (FR-009).

**Entscheidung**: Die Hilfsfunktionen sammeln Probleme in einer Liste, statt zu werfen. `loadConfig` wirft am Ende eine `ConfigError` mit allen Problemen, die erste Zeile bleibt `Missing required environment variable: <NAME>` bzw. `Environment variable <NAME> must be an integer`, ohne Rohwert. Neue Funktion `checkConfig(env)` in `config/check.ts` nutzt dieselben Hilfsfunktionen und liefert zusätzlich Befunde, die `loadConfig` nicht prüft (strenger oder nur Warnung):

| Prüfung | Stufe |
|---|---|
| Pflichtvariablen fehlen oder leer | Fehler |
| Zahlen nicht ganzzahlig, Ports außerhalb 1–65535, Zeiten/Größen < 0 | Fehler |
| Booleans nicht `true`/`false` | Fehler |
| `BACKEND_DATABASE_URL`, `BACKEND_REDIS_URL`, `BACKEND_LOGTO_ENDPOINT` keine gültige URL (richtiges Schema) | Fehler |
| `BACKEND_CREDENTIAL_ENCRYPTION_KEY` nicht Base64 mit genau 32 Byte | Fehler |
| `BACKEND_APP_LOG_LEVEL` nicht in debug/info/warning/error/fatal | Fehler |
| `BACKEND_SMTP_HOST` leer oder `localhost`, `BACKEND_NOTIFICATION_FROM_ADDRESS` leer oder endet auf `@localhost` | Warnung (Benachrichtigungen) |
| Management-Client-ID, -Secret oder -Basis-URL fehlt (teilweise oder ganz) | Warnung (Passwortänderung in der App) |
| `BACKEND_AGENT_PUBLIC_URL` leer | Warnung (Traefik-Agents anlegen) |

Befunde nennen Variablenname und Grund, nie den Wert. Für Geheimnisse (Schlüssel, Passwörter, Secrets, URL-Zugangsdaten) gilt das ohnehin, für alle anderen Werte aus Vorsicht auch.

**Begründung**: Die Hilfsfunktionen als einzige Stelle zu behalten verhindert, dass `validate-config` und der Start auseinanderlaufen. Der Test aus §8 sichert das zusätzlich.

**Verworfen**: Ein zweites Schema (zod o. Ä.): doppelte Wahrheit, neue Abhängigkeit. `loadConfig` strenger machen: bricht die Tests, die Platzhalterwerte nutzen.

## §5 Online-Prüfung

**Entscheidung**: Mit `--online` laufen drei Prüfungen parallel mit je 5 s Frist:

- **Postgres**: Verbindung öffnen, `SELECT 1`.
- **Redis**: Verbindung ohne Wiederholversuche, `PING`.
- **Logto**: `GET <endpoint>/oidc/jwks`, erwartet HTTP 200 mit `keys`. Das ist der Endpunkt, den das Backend bei jedem Request nutzt.

Ausgegeben werden Dienst, Ergebnis und eine kurze Ursache (Fehlercode wie `ECONNREFUSED`, HTTP-Status oder `timeout`), nie die Verbindungsadresse mit Zugangsdaten und nie eine rohe Fehlermeldung eines Treibers (kann die URL enthalten). Der Host darf erscheinen, Benutzer und Passwort nie.

**Verworfen**: Weitere Prüfungen (SMTP-Verbindung, Management-API): optionale Funktionen, eigener Aufwand, nicht gefordert.

## §6 Ausgabe und Exit-Codes

Ausgabe auf stdout (Befunde, Zusammenfassung) und stderr (Fehler der Bedienung), ohne Logdatei und ohne Logger-Konfiguration (Twelve-Factor Logs: Stream). `migrate` loggt nichts über die Anwendungslogs, sondern gibt Zeilen aus ("applied 0003_…", "up to date"). Exit-Codes: `0` Erfolg (Warnungen erlaubt), `1` Fehler in der geprüften Sache (Befund Fehler, Datenbank nicht erreichbar, Migration fehlgeschlagen), `2` falsche Benutzung (unbekannter Befehl, ungültige Option, fehlendes Argument). Das Detail steht in [contracts/cli.md](./contracts/cli.md).

**`migrate` braucht nur `BACKEND_DATABASE_URL`** (FR-005): Der Befehl liest die Variable direkt und ruft nicht `loadConfig` auf. Fehlt sie, endet er mit Exit-Code 1 und nennt den Namen.

## §7 Compose: Migrationsschritt und Healthchecks

**Ist-Stand**: `docker-compose.yml` definiert `app` (`command: node backend/dist/main.js`, `depends_on` Postgres/Redis healthy), `frontend` (`serve --single frontend/dist -l 3000`, `depends_on: app`), ohne Healthchecks für beide. Das Image ist Alpine (`node:24.22.2-alpine3.24`), enthält BusyBox-`wget`.

**Entscheidung**:

- Neuer Dienst `migrate`: gleiches Image (`build` wie die anderen), `command: ["node", "backend/dist/cli.js", "migrate"]`, `env_file: .env`, `restart: "no"`, `depends_on` Postgres healthy. `app` bekommt `depends_on: migrate: condition: service_completed_successfully`.
- `app`-Healthcheck: `CMD-SHELL` mit `wget -q -O /dev/null http://127.0.0.1:$${BACKEND_PORT:-8080}/readyz`. Bereitschaft statt Lebendigkeit, damit "ungesund" bei Ausfall von Postgres/Redis erscheint (SC-005).
- `frontend`-Healthcheck: `wget -q -O /dev/null http://127.0.0.1:3000/`. `frontend` bekommt `depends_on: app: condition: service_healthy`.
- Werte: `interval: 10s`, `timeout: 5s`, `retries: 4`, `start_period: 20s`.
- Die Dockerfile bleibt ohne `HEALTHCHECK`, weil das Image beide Rollen bedient (FR-015).

**Hinweis**: Ist `BACKEND_BIND_ADDRESS` auf eine bestimmte Adresse gesetzt, erreicht `127.0.0.1` den Server nicht. Das gehört in die Doku (Healthcheck-Adresse anpassen). Der Standard `0.0.0.0` ist unproblematisch.

**Verworfen**: HEALTHCHECK im Dockerfile (falsch für eine der Rollen). Ein CLI-Befehl `healthcheck` (kein Mehrwert gegenüber `wget`, nötig nur, wenn das Image kein `wget` hat). `/healthz` als Test für `app` (zeigt nicht, dass die Abhängigkeiten fehlen).

## §8 Tests

- **Unit**: `checkConfig` (jede Zeile der Tabelle in §4, keine Werte in der Ausgabe, mehrere Probleme in einem Lauf). `loadConfig` sammelt alle Probleme. Ein Test belegt, dass jede Variable, die `loadConfig` liest, von `checkConfig` abgedeckt ist (Drift-Schutz). CLI-Befehlstabelle: Hilfe, unbekannter Befehl (2), Exit-Codes.
- **Integration** (echtes Postgres): `runMigrations` zweimal gleichzeitig (SC-001), Wiederholung ohne Arbeit, fehlgeschlagene Migration lässt `schema_migrations` unverändert, `assertSchemaCurrent` bei leerer, veralteter und aktueller Datenbank. Befehl `migrate` und `validate-config --online` gegen die echten Dienste.
- **Compose**: manuell (quickstart.md), kein automatischer Test (kein Compose im CI).

## §9 Prüfungen gegen das echte Image (erledigt am 2026-10-29)

Alle drei Annahmen wurden gegen das gebaute Image und die installierte Compose-Version (5.5.0) bestätigt:

- BusyBox-`wget` beendet bei HTTP 503 mit Exit-Code 1 (`wget: server returned error: HTTP/1.1 503 Service Unavailable`), bei 200 mit 0.
- `service_completed_successfully` funktioniert (Test mit zwei Diensten: der zweite startet erst nach Ende des ersten).
- `serve --single` liefert unter `/` den Status 200.

**Zusätzlicher Befund**: Das Backend stürzte ab, sobald Postgres wegfiel (der Pool meldete einen `error` auf einer Leerlaufverbindung, den niemand abfing). Damit hätte `app` nie "ungesund" gemeldet, sondern der Container wäre beendet worden. Behoben mit `createPool` (`adapters/event-store-postgres/pool.ts`): Der Handler loggt nur, `/readyz` antwortet 503 und der Prozess erholt sich, sobald Postgres zurück ist (geprüft: up → 503 bei gestopptem Postgres → wieder 200). Dieses Verhalten gehört zu Story 3.

Ursprünglich offene Fragen:

- BusyBox-`wget` beendet bei HTTP 503 mit Exit-Code ≠ 0 (Annahme für den `/readyz`-Test). Prüfen mit dem gebauten Image, bevor der Healthcheck als fertig gilt.
- `service_completed_successfully` wird von der eingesetzten Compose-Version unterstützt (Compose v2).
- `serve` liefert unter `/` den Statuscode 200 (SPA, `--single`).

## §10 Betroffene Dokumente

- `docs/12-factor-backlog.md`: Punkt 2 entfernen. Punkt 9 auf den Rest kürzen (stille Entwicklungswerte beim Start; `BACKEND_LOGTO_APP_ID/_SECRET` ungenutzt).
- `docs/configuration.md`: Hinweis auf `validate-config`; die beiden Logto-Variablen als vom Backend ungenutzt vermerken.
- `docs/development.md`, `README.md`, `CLAUDE.md`: Befehlsliste (`cli`, `migrate`), Startreihenfolge, Hinweis auf den Migrationsschritt.
- `docs/release.md`: Das Beispiel `docker run … node backend/dist/main.js` bekommt den vorgelagerten Migrationsschritt.
- Nicht betroffen: `Dockerfile`, `docker-entrypoint.sh`, Agent, `proto/`.
