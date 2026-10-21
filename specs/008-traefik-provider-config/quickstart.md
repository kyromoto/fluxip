# Quickstart: Validierung der Traefik-Provider-Verteilung

Ein Leitfaden zum Prüfen des Features Ende zu Ende. Er enthält keine Implementierung. Verträge stehen in [contracts/](./contracts/), Datenmodell in [data-model.md](./data-model.md).

## Voraussetzungen

- Lokale Umgebung wie bisher: `docker compose up postgres redis logto app` und `.env` aus `.env.example`.
- Neu in `.env`: `BACKEND_AGENT_PORT=8081`, `BACKEND_AGENT_PUBLIC_URL=http://localhost:8081` (lokal ohne TLS; der Agent erlaubt `http://` nur mit `--insecure`).
- Go (aktuelle stabile Version) für `agent/`.
- Ein Verzeichnis `./tmp/out` als Ziel und `./tmp/templates` für Vorlagen.
- Optional ein Traefik v3 mit File Provider (`directory: ./tmp/out`, `watch: true`) für Szenario 8.

## 1. Agent anlegen und starten (US1)

```bash
# Backend + Frontend starten (bestehendes Vorgehen), dann in der UI:
#   Agents → Add an agent → Name "Test" → Token und Startbefehl kopieren
cd agent && go build -o ../tmp/fluxip-agent ./cmd/fluxip-agent
./tmp/fluxip-agent templates --write ./tmp/templates
FLUXIP_ADDRESS=<Agent-Adresse> FLUXIP_TOKEN=<Token> \
FLUXIP_TEMPLATES_DIR=./tmp/templates FLUXIP_OUTPUT_DIR=./tmp/out ./tmp/fluxip-agent run
```

Erwartet:

- UI zeigt den Provider innerhalb von 10 s als "Connected".
- `./tmp/out/fluxip-allowlist.yml` existiert und enthält den Fallback (leere Gruppe).
- Falsches Token → Agent beendet den Versuch mit der Meldung `invalid or revoked token for this agent address`, schreibt nichts.

## 2. Aktion anlegen, IP-Änderung auslösen (US2, US3)

1. In der UI am Gerät: Aktion "Traefik-Konfiguration liefern" → Provider "Test", Gruppe `admin-allowlist`.
2. Einen DynDNS-Report mit neuer IP an den Trigger-Endpunkt senden (Vorgehen wie in `specs/001-ip-change-automation/quickstart.md`).
3. Nach Ablauf des Entprellfensters (Standard 30 s) die Zeit bis zur Datei messen.

Erwartet: `fluxip-allowlist.yml` enthält `<neue-IP>/32`, nicht mehr die alte. Dauer ab bestätigter Änderung ≤ 10 s in 95 % von 20 Wiederholungen (SC-001).

Zusätzlich prüfen:

- Änderung an Provider B löst bei Agent A **keinen** Snapshot aus (Agent-Log: keine neue `correlation_id`).
- Derselbe Inhalt erneut → Datei-Änderungszeit (`stat`) bleibt gleich (US3-3).

## 3. Fehlerverhalten und Sicherheit der Dateien (US4, SC-004)

```bash
# ungültige Vorlage zusätzlich ablegen
printf 'http: [unclosed\n' > ./tmp/templates/broken.yml.tmpl
# SIGHUP an den laufenden Agent → Vorlage wird abgelehnt, alte Menge bleibt
kill -HUP $(pgrep fluxip-agent)
```

Erwartet: Agent-Log mit Fehler, Bericht `error` in der UI (am Provider sichtbar), `fluxip-allowlist.yml` unverändert. `./tmp/out/andere.yml` (ohne Präfix) bleibt immer unberührt. Eine entfernte Vorlage entfernt nach erfolgreichem Anwenden ihre Datei.

Abbruchtest: Agent während des Schreibens mit `kill -9` beenden (Schleife über 200 Läufe). Danach darf nie eine halb geschriebene oder leere `.yml` existieren (nur `.tmp`-Reste).

## 4. Ausfall und Neustart (US5, SC-003)

1. FluxIP-Backend stoppen. Dateien bleiben unverändert, Agent verbindet mit wachsendem Abstand neu (Log).
2. Agent neu starten (Backend noch aus): Dateien bleiben.
3. `./tmp/out` leeren, Agent starten (Backend aus): Dateien erscheinen mit Fallback.
4. Mit `FLUXIP_MAX_OFFLINE=1m` starten, Backend aus lassen: Nach 1 min rendert der Agent mit `.Stale`, der Fallback steht in der Datei. System-Uhr während des Tests um Stunden vor- und zurückstellen: Der Zeitpunkt ändert sich nicht (monotone Uhr, FR-051).
5. Backend starten: Agent erhält den vollen Stand ohne Zutun, UI zeigt `verbunden`.

## 5. Zugangsdaten (US7)

- Zweites Token erzeugen: beide gültig. Mit dem alten Agent verbunden bleiben, neues Token zweitem Agent geben.
- Altes Token widerrufen: Sitzung endet binnen 1 s, Agent meldet die verständliche Fehlermeldung.
- Dritten Token versuchen: `409 token_limit_reached`.
- Provider mit Aktion löschen: `409 traefik_provider_in_use` mit Liste.
- 10 falsche Tokens in 5 min von einer Quelle: `RESOURCE_EXHAUSTED` für diese Quelle (auch mit richtigem Token). Ein gültiger Agent von anderer IP verbindet weiter.

## 6. Zwei Agents, ein Token (Randfall)

Zweiten Agent mit demselben Token starten: der erste erhält `Bye{superseded}`, der Provider zeigt den Hinweis `previous_session_superseded`.

## 7. Variante B (US8)

- UI: "FluxIP verbindet zum Agent" sichtbar, deaktiviert, "noch nicht verfügbar".
- `POST /api/agents` mit `connectionMode: "server_initiated"` → `422 connection_mode_not_available`.

## 8. Mit echtem Traefik (Annahmen aus research.md §16)

1. Traefik v3 mit `providers.file.directory` und `watch: true` auf `./tmp/out`. Eine Route verwendet `admin-allowlist@file`.
2. IP ändern → Zugriff mit alter IP wird abgelehnt, mit neuer erlaubt, ohne Traefik-Neustart.
3. Leere Gruppe: Zugriff von fremden IPs wird abgelehnt (Fallback gültig, Middleware lädt).
4. Dateien mit `.tmp` im Verzeichnis lösen kein Neuladen aus.
5. `FLUXIP_TRAEFIK_API` setzen: Bericht enthält `traefik_check: OK`.
6. **gRPC hinter Traefik**: Agent über den vorgeschalteten Traefik (h2c-Router, Beispiel in `deploy/traefik/agents-router.example.yml`) verbinden und mindestens 3 Minuten laufen lassen. Die Sitzung muss ohne Wiederverbindung stehen (Agent-Log ohne `session ended, will reconnect`). Mit dem Traefik-Standard `readTimeout` (60 s) kommt es dagegen minütlich zu `RST_STREAM`; dann `respondingTimeouts.readTimeout: 0` am Agent-Entrypoint setzen.

## 9. Automatisierte Tests (müssen grün sein)

```bash
pnpm --filter fluxip-backend test           # Snapshot, Token, Handler, gRPC-Integration
pnpm --filter fluxip-frontend test          # neue Schritte und Seite
cd agent && go test ./...                   # Renderer, Validierung, Atomik, Präfix, Backoff, Uhr
cd agent && go test -run TestE2E ./...      # Agent gegen In-Process-Server
```

## 10. Release-Prüfung (FR-062, SC-005)

- `agent-v*`-Release erzeugt `fluxip-agent-linux-amd64`, `…-arm64` und `SHA256SUMS`.
- Größe beider Binaries < 30 MB (CI-Schritt). Leerlauf-RAM < 50 MB (`/usr/bin/time -v` oder `ps` im E2E-Test).
- Das Backend-Release (`vX.Y.Z`) bleibt von Agent-Tags unbeeinflusst.
