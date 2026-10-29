# Quickstart: Admin-CLI und Healthchecks prüfen

Voraussetzungen: `docker compose up -d postgres redis`, `BACKEND_DATABASE_URL` und `BACKEND_REDIS_URL` gesetzt (CLAUDE.md, docs/configuration.md), Abhängigkeiten installiert (`pnpm install`).

## 1. Tests

```bash
pnpm --filter fluxip-backend test -- tests/unit
pnpm --filter fluxip-backend test -- tests/integration/migrate-cli.test.ts tests/integration/schema-check.test.ts
pnpm --filter fluxip-backend lint
```

Erwartet: Unit-Tests für `checkConfig`, `loadConfig` und die Befehlstabelle grün, Integrationstests für gleichzeitige Migration, Schemaprüfung und CLI grün. Bekannte Fehler der Ausgangslage (vier Integrationsdateien, siehe Memory) bleiben unverändert.

## 2. CLI von Hand

```bash
# Hilfe, ohne Konfiguration
pnpm --filter fluxip-backend cli help; echo "exit=$?"            # 0
pnpm --filter fluxip-backend cli bogus; echo "exit=$?"           # 2

# Migration auf leerer Datenbank (neue Datenbank anlegen oder Schema verwerfen)
pnpm --filter fluxip-backend cli migrate                         # applied ..., exit 0
pnpm --filter fluxip-backend cli migrate                         # up to date, exit 0

# gleichzeitig
( pnpm --filter fluxip-backend cli migrate & pnpm --filter fluxip-backend cli migrate & wait )

# Konfiguration
env -i PATH="$PATH" pnpm --filter fluxip-backend cli validate-config; echo "exit=$?"   # alle Pflichtwerte genannt, 1
pnpm --filter fluxip-backend cli validate-config --online        # ok/FAIL je Dienst
```

Prüfen: Kein Geheimnis erscheint in der Ausgabe (z. B. `BACKEND_CREDENTIAL_ENCRYPTION_KEY=geheim-xyz` setzen und in der Ausgabe suchen).

## 3. Start gegen veraltetes Schema

```bash
# Datenbank ohne Migration, App starten
pnpm dev:backend                                                 # bricht mit Hinweis auf `migrate` ab, exit 1
pnpm --filter fluxip-backend cli migrate && pnpm dev:backend     # startet
```

## 4. Compose

```bash
docker compose up -d --build
docker compose ps                                                # migrate: exited (0), app/frontend: healthy
docker compose stop postgres && sleep 90 && docker compose ps    # app: unhealthy
docker compose start postgres && sleep 60 && docker compose ps   # app: healthy
```

Zusätzlich im Image prüfen (research.md §9): `docker compose exec app wget -q -O /dev/null http://127.0.0.1:8080/readyz; echo $?` liefert bei gestopptem Postgres einen Wert ungleich 0.
