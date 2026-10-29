# Quickstart: Traefik-Lieferung in der Geräte-History prüfen

Voraussetzungen: `docker compose up -d postgres redis`, `BACKEND_DATABASE_URL` und `BACKEND_REDIS_URL` gesetzt (siehe CLAUDE.md und docs/configuration.md).

## 1. Backend-Tests

```bash
pnpm --filter fluxip-backend test -- tests/unit/adapters/agent-grpc/snapshot-coordinator.test.ts
pnpm --filter fluxip-backend test -- tests/integration/ip-client-history-traefik.test.ts
```

Erwartet:
- Der Coordinator sammelt alle `causationId`s eines Fensters. Die letzte wird zur `correlationId`, die übrigen landen in `absorbedCausationIds`.
- Die History-Route liefert `deliveries` gemäß [contracts/history-api.md](./contracts/history-api.md) für: angewendet, nur veröffentlicht, Fehler, aufgegangene Änderung, Änderung ohne Snapshot (keine Zeile), Gerät ohne Traefik-Aktion (`deliveries: []`).

## 2. Frontend-Test

```bash
pnpm --filter fluxip-frontend test -- tests/unit/device-history-page.test.tsx
```

Erwartet: Traefik-Zeilen mit Agent-Name, Gruppe, Stufe und Zeit, getrennt von Ausführungen. Hinweis für `combined`. Bestehende Tests unverändert grün.

## 3. Manuell

1. Gerät mit einer DNS-Aktion und einer Traefik-Aktion anlegen, Agent verbinden.
2. IP-Änderung auslösen. History öffnen: unter der Änderung steht die DNS-Ausführung und eine Traefik-Zeile "veröffentlicht", nach der Rückmeldung des Agents "angewendet".
3. Agent trennen, erneut ändern: Zeile bleibt "veröffentlicht".
4. Zwei Änderungen innerhalb von `BACKEND_AGENT_SNAPSHOT_COALESCE_MS`: die frühere zeigt "zusammen mit einer späteren Änderung geliefert".
5. Änderung, die den Inhalt nicht verändert: keine Traefik-Zeile.
