# Data Model: Admin-CLI und Healthchecks

Es gibt **keine neuen gespeicherten Entitäten** und keine neue Migration. Die CLI liest und schreibt nur die vorhandene Tabelle `schema_migrations`. Alles Weitere sind kurzlebige Ergebnisobjekte der CLI.

## Bestehend: `schema_migrations`

| Feld | Typ | Bedeutung |
|---|---|---|
| `filename` | TEXT, Primärschlüssel | Dateiname der Migration (`0001_events.sql`, ...) |
| `applied_at` | TIMESTAMPTZ, Default `now()` | Zeitpunkt der Anwendung |

Regeln:
- Die Reihenfolge ergibt sich aus der Sortierung der Dateinamen im Migrationsverzeichnis.
- **Ausstehend** = Datei vorhanden, aber kein Eintrag. Einträge ohne Datei (Datenbank neuer als die App) sind erlaubt und werden ignoriert.
- Eine Migration und ihr Eintrag entstehen in einer Transaktion (alles oder nichts).
- Ein Lauf hält die Sitzungssperre `pg_advisory_lock(hashtext('fluxip:migrate'))`.

## Ergebnisobjekte (nur Laufzeit)

### Konfigurationsbefund

| Feld | Bedeutung |
|---|---|
| `name` | Name der Umgebungsvariable |
| `level` | `error` \| `warning` |
| `reason` | kurzer Grund (fehlt, keine ganze Zahl, ungültige URL, kein 32-Byte-Base64-Wert, ...) |
| `feature` | nur bei `warning`: Funktion, die dadurch nicht arbeitet (Benachrichtigungen, Passwortänderung in der App, Traefik-Agents) |

Es gibt keinen Befund `ok` je Variable. Die Ausgabe nennt nur Probleme und eine Zusammenfassung. Der Befund enthält nie den Wert der Variable.

### Erreichbarkeitsbefund (nur `--online`)

| Feld | Bedeutung |
|---|---|
| `service` | `postgres` \| `redis` \| `logto` |
| `ok` | erreichbar |
| `reason` | bei Fehler: Fehlercode (`ECONNREFUSED`, ...), HTTP-Status oder `timeout`, nie Zugangsdaten |

### Migrationslauf

| Feld | Bedeutung |
|---|---|
| `applied` | Liste der in diesem Lauf angewendeten Dateinamen (leer = nichts zu tun) |
| `failed` | bei Fehler: Dateiname und Ursache der fehlgeschlagenen Migration |

### Gesundheitszustand (Compose)

Kein eigenes Datenobjekt, sondern der von der Laufzeitumgebung geführte Zustand `starting` → `healthy` / `unhealthy`. Die Tests liefern die Endpunkte `/readyz` (`app`) und `/` (`frontend`), siehe [contracts/compose-health.md](./contracts/compose-health.md).
