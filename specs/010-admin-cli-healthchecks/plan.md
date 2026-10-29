# Implementation Plan: Admin-CLI und Healthchecks

**Branch**: `010-admin-cli-healthchecks` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-admin-cli-healthchecks/spec.md`

## Summary

Das Backend bekommt eine kleine CLI (`backend/src/cli.ts`) mit zwei Befehlen. `migrate` wendet die Datenbankmigrationen unter einem Advisory Lock als One-off-Prozess an. `validate-config [--online]` meldet alle Konfigurationsprobleme in einem Lauf, ohne Werte auszugeben, und prüft optional die Erreichbarkeit von Postgres, Redis und Logto. Der Webprozess migriert beim Start nicht mehr, sondern bricht bei veraltetem Schema mit einem Hinweis auf `migrate` ab. Das Compose führt die Migration als einmaligen Dienst vor `app` aus und bekommt Healthchecks für `app` (`/readyz`) und `frontend`.

Im Plan zeigte sich, dass `BACKEND_LOGTO_APP_ID/_SECRET` im Backend nirgends gelesen werden. Die Spec wurde angepasst (FR-009): Sie werden nicht geprüft, dafür ist der Verschlüsselungsschlüssel ein Pflichtwert mit Formatprüfung. Es gibt keine neue gespeicherte Entität und keine neue Abhängigkeit.

## Technical Context

**Language/Version**: TypeScript 5.7 auf Node.js 24 (bestehend, Backend `backend/`). Kein Frontend-Code, kein Agent.

**Primary Dependencies**: `pg`, `ioredis` (beide bestehend), `node:util` `parseArgs`, `fetch` (Node). Keine neuen Pakete.

**Storage**: PostgreSQL-Ereignisspeicher unverändert. Gelesen und geschrieben wird nur `schema_migrations`. Keine neue Migration.

**Testing**: Backend Vitest. Unit-Tests ohne Infrastruktur für `checkConfig`, `loadConfig` und die CLI-Befehlstabelle. Integrationstests gegen echtes Postgres und Redis (CLAUDE.md) für Migration, Sperre, Schemaprüfung und CLI. Compose-Verhalten manuell (quickstart.md).

**Target Platform**: Linux-Container (`node:24-alpine`), lokal Node 24.

**Project Type**: Web-Anwendung (`backend/`, `frontend/`), hier nur Backend und Compose/Doku.

**Performance Goals**: Nicht kritisch. Migrationslauf ist bei wenigen Dateien in Sekunden fertig, jede Online-Prüfung endet nach höchstens 5 s.

**Constraints**: Keine Secrets in der CLI-Ausgabe. `migrate` braucht nur `BACKEND_DATABASE_URL`. `--help` funktioniert ohne Konfiguration. Das Dockerfile bleibt ohne `HEALTHCHECK` (ein Image, mehrere Rollen).

**Scale/Scope**: Zwei Befehle, eine Funktion für den Schema-Stand, ein Compose-Dienst, zwei Healthchecks, Dokumentation.

## Constitution Check

*GATE: Muss vor Phase 0 bestehen, nach Phase 1 erneut prüfen.*

| Prinzip | Bewertung |
|---|---|
| I. Explicit Commit Authorization | Es wird nicht automatisch committet. |
| II. Twelve-Factor – Admin-Prozesse | Das Feature **setzt** die Regel um: Migrationen laufen als One-off (`migrate`), nicht mehr beim Start des Webprozesses. |
| II. Twelve-Factor – Config | Konfiguration bleibt ausschließlich in Umgebungsvariablen und wird jetzt vor dem Deploy validiert. Der Start validiert weiter früh (`loadConfig`). |
| II. Twelve-Factor – Logs | CLI-Ausgabe geht auf stdout/stderr, keine Dateien. |
| II. Twelve-Factor – Disposability/Prozesse | Die CLI ist zustandslos, schließt Verbindungen, hält die Sperre nur für die Laufzeit (und sie fällt bei Verbindungsabbruch weg). |
| II. Twelve-Factor – Build/Release/Run | Dasselbe Image enthält die CLI. Das Dockerfile ändert sich nicht. |
| Backlog (`docs/12-factor-backlog.md`) | Punkt 2 wird gelöst, Punkt 9 teilweise. Beide Einträge werden im Zug der Umsetzung angepasst (Spec FR-018). Keine Verschlechterung anderer Punkte. |

Ergebnis: bestanden, keine Abweichung, kein Eintrag unter Complexity Tracking. Nach Phase 1 unverändert bestanden.

## Project Structure

### Documentation (this feature)

```text
specs/010-admin-cli-healthchecks/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── compose-health.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks, nicht Teil von /speckit-plan
```

### Source Code (repository root)

```text
backend/
├── package.json                                   # Script "cli": "tsx src/cli.ts"
├── src/
│   ├── cli.ts                                     # NEU: Befehlstabelle, parseArgs, Exit-Codes, dynamische Importe
│   ├── main.ts                                    # runMigrations -> assertSchemaCurrent
│   ├── config/
│   │   ├── env.ts                                 # Hilfsfunktionen sammeln Probleme; ConfigError; ohne Rohwert
│   │   └── check.ts                               # NEU: checkConfig(env) -> Befunde (Fehler/Warnung)
│   ├── adapters/event-store-postgres/migrate.ts   # Advisory Lock, Rückgabe der angewendeten Dateien, assertSchemaCurrent
│   ├── adapters/event-store-postgres/pool.ts      # NEU: createPool mit error-Handler
│   └── cli/
│       ├── migrate-command.ts                     # NEU
│       ├── validate-config-command.ts             # NEU
│       └── online-checks.ts                       # NEU: Postgres, Redis, Logto mit Frist
└── tests/
    ├── unit/config/check.test.ts                  # NEU
    ├── unit/config/env.test.ts                    # NEU
    ├── unit/cli.test.ts                           # NEU
    └── integration/
        ├── migrate-cli.test.ts                    # NEU: Sperre, Wiederholung, Fehlschlag, CLI
        └── schema-check.test.ts                   # NEU: assertSchemaCurrent

docker-compose.yml                                 # Dienst migrate, Healthchecks, depends_on
docs/12-factor-backlog.md, docs/configuration.md, docs/development.md, README.md, CLAUDE.md
```

**Structure Decision**: Bestehende Web-Struktur, nur Backend. Die CLI-Befehle liegen in `backend/src/cli/` und werden von `cli.ts` dynamisch geladen, damit die Hilfe ohne Konfiguration läuft. Die Konfigurationsprüfung teilt sich die Hilfsfunktionen mit `loadConfig` in `config/`, damit es eine Quelle der Wahrheit gibt (research.md §4).

## Design-Überblick

1. **Migration unter Sperre** (`migrate.ts`): `runMigrations(pool)` hält `pg_advisory_lock` auf einer eigenen Verbindung, legt die Tabelle an, wendet ausstehende Dateien in je einer Transaktion an und gibt die Liste zurück (research.md §2). `assertSchemaCurrent(pool)` meldet ausstehende Dateien als `SchemaOutdatedError` mit Hinweis auf den Befehl (research.md §3).
2. **Start** (`main.ts`): ruft `assertSchemaCurrent` statt `runMigrations`. Der bestehende Fatal-Handler gibt die Meldung aus und beendet mit Exit-Code 1.
3. **Konfiguration** (`env.ts`, `check.ts`): Hilfsfunktionen sammeln Probleme, `loadConfig` wirft am Ende alle gesammelt (`ConfigError`). `checkConfig` liefert zusätzlich die strengeren Prüfungen und Warnungen nach der Tabelle in research.md §4. Ausgaben enthalten nie Werte. `check.ts` exportiert dazu ein Register der bekannten Variablen (`KNOWN_VARS`).
4. **CLI** (`cli.ts` und `cli/*`): Befehlstabelle mit `migrate` und `validate-config`. `migrate` liest nur `BACKEND_DATABASE_URL`, `validate-config` nutzt `checkConfig` und mit `--online` `online-checks.ts` (Postgres, Redis, Logto-JWKS, je 5 s Frist, parallel, ohne Zugangsdaten in der Ausgabe). Exit-Codes 0/1/2 gemäß [contracts/cli.md](./contracts/cli.md).
5. **Pool** (`adapters/event-store-postgres/pool.ts`): `createPool` fängt `error`-Ereignisse der Verbindungen ab und loggt sie, damit das Backend einen Postgres-Ausfall überlebt und `/readyz` 503 meldet, statt dass der Prozess beendet wird (research.md §9).
6. **Compose** (`docker-compose.yml`): Dienst `migrate` (einmalig), `app` wartet auf dessen Erfolg, Healthchecks für `app` (`/readyz`) und `frontend` (`/`), `frontend` wartet auf `app` healthy (research.md §7, [contracts/compose-health.md](./contracts/compose-health.md)).
7. **Doku und Backlog**: Befehle und Startreihenfolge in README, `docs/development.md`, `CLAUDE.md`. `docs/configuration.md` verweist auf `validate-config` und vermerkt die ungenutzten Logto-Variablen. `docs/12-factor-backlog.md`: Punkt 2 entfernen, Punkt 9 auf den Rest kürzen.

## Risiken

- **Betriebsänderung**: Wer das Backend heute ohne Vorbereitung startet, bekommt nach dem Update den Hinweis auf `migrate`. Das Compose deckt den Standardfall ab. Alle anderen Deployments (Orchestrator, eigene Skripte) brauchen den Schritt. README und Release-Hinweis nennen ihn.
- **Drift zwischen `loadConfig` und `checkConfig`**: Der Test aus research.md §8 deckt jede gelesene Variable ab. Dazu liest `checkConfig` über dieselben Hilfsfunktionen.
- **Sperre bei hängender Verbindung**: Ein toter Prozess hält die Sitzungssperre nur, bis Postgres die Verbindung bemerkt (TCP-Timeout). Der wartende Aufruf blockiert so lange. Im `migrate`-Befehl gibt es dafür keine eigene Frist (bewusst, siehe Annahme "wenige Migrationen"). Dies ist als Hinweis in `docs/development.md` zu nennen.
- **`wget`-Verhalten bei 503** und weitere Annahmen sind gegen das gebaute Image zu bestätigen (research.md §9).

## Complexity Tracking

Keine Abweichungen von der Constitution.
