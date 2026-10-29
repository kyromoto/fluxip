# Contract: Backend-CLI

Aufruf im Container: `node backend/dist/cli.js <befehl> [optionen]`. Lokal: `pnpm --filter fluxip-backend cli <befehl> [optionen]`.

## Befehle

| Befehl | Zweck | Benötigt |
|---|---|---|
| `migrate` | Wendet alle ausstehenden Migrationen an, ohne die App zu starten | `BACKEND_DATABASE_URL` |
| `validate-config [--online]` | Prüft die Konfiguration aus den Umgebungsvariablen, mit `--online` auch die Erreichbarkeit von Postgres, Redis und Logto | Umgebungsvariablen (keine Pflicht, fehlende werden gemeldet) |
| `help`, `--help`, `-h`, kein Argument | Zeigt die Befehle | nichts |

## Exit-Codes

| Code | Bedeutung |
|---|---|
| `0` | Erfolg (bei `validate-config` auch mit Warnungen) |
| `1` | Fehler in der geprüften Sache: Konfigurationsfehler, Dienst nicht erreichbar, Migration fehlgeschlagen, `BACKEND_DATABASE_URL` fehlt |
| `2` | Falsche Benutzung: unbekannter Befehl, unbekannte Option |

`help` ohne weiteres Argument endet mit `0`. Ein unbekannter Befehl zeigt die Hilfe auf stderr und endet mit `2`.

## `migrate`

Ausgabe (stdout), eine Zeile je Ereignis:

```text
applied 0001_events.sql
applied 0002_fix_events_unique_constraint.sql
2 migration(s) applied
```

oder

```text
up to date
```

Bei Fehler (stderr), Exit-Code 1:

```text
migration 0003_rename_tenant_id_to_account_id.sql failed: <ursache>
```

Verhalten:
- Hält `pg_advisory_lock` für den Lauf. Ein zweiter gleichzeitiger Aufruf wartet und endet mit `up to date`, Exit-Code 0.
- Jede Migration läuft in einer Transaktion. Bei Fehler bleibt sie ohne Wirkung, bereits angewendete bleiben bestehen.
- Startet keinen Webserver, keine Worker, keinen Agent-Server. Schließt die Datenbankverbindung vor dem Ende.
- Die Ursache enthält keine Verbindungsadresse mit Zugangsdaten.

## `validate-config [--online]`

Ausgabe (stdout), nur Probleme, dann Zusammenfassung:

```text
ERROR BACKEND_DATABASE_URL: missing
ERROR BACKEND_CREDENTIAL_ENCRYPTION_KEY: not a base64-encoded 32-byte key
WARN  BACKEND_SMTP_HOST: empty or localhost (email notifications will not work)
2 error(s), 1 warning(s)
```

Bei Erfolg: `configuration ok` (mit ` (N warning(s))`, wenn Warnungen vorliegen).

Mit `--online` folgt je Dienst eine Zeile:

```text
ok    postgres
ok    redis
FAIL  logto: HTTP 502
```

Verhalten:
- Meldet alle Probleme in einem Lauf, nicht nur das erste.
- Gibt nie den Wert einer Variable aus (weder Geheimnisse noch andere Werte).
- Jede Online-Prüfung endet nach spätestens 5 s (`timeout`). Eine Zeitüberschreitung eines Dienstes verhindert die Prüfung der anderen nicht.
- Exit-Code 1, wenn mindestens ein `ERROR` oder `FAIL` vorliegt, sonst 0.
- Prüfumfang und Stufen: siehe research.md §4.

## Hilfetext

```text
Usage: node backend/dist/cli.js <command> [options]

Commands:
  migrate                     Apply pending database migrations (needs BACKEND_DATABASE_URL)
  validate-config [--online]  Check the configuration; --online also checks Postgres, Redis and Logto

Exit codes: 0 ok, 1 failed, 2 usage error.
```

## Start der Anwendung (Folgeänderung)

`node backend/dist/main.js` migriert nicht mehr. Ist die Datenbank veraltet, bricht der Start mit Exit-Code 1 ab und schreibt auf stderr:

```text
Fatal error during startup: Database schema is outdated: 1 pending migration(s) (0003_rename_tenant_id_to_account_id.sql). Run: node backend/dist/cli.js migrate
```
