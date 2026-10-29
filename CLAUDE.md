# CLAUDE.md

FluxIP reagiert auf IP-Wechsel (z. B. von einer FritzBox gemeldet) und führt Actions aus: Hetzner-DNS, Hetzner-Firewall, Traefik-Allow-Lists. Überblick: [README.md](README.md), [docs/architecture.md](docs/architecture.md).

## Aufbau

pnpm-Workspace plus ein Go-Modul. Details und Strukturbaum in [docs/development.md](docs/development.md).

- `backend/`: Hono-API, Event-Sourcing-Domäne, BullMQ-Worker, Adapter (Postgres, Redis, Logto, Hetzner, E-Mail)
- `frontend/`: SolidJS, Tailwind, Kobalte/Solid UI
- `agent/`: Go-Agent für Traefik-Hosts (eigenes Modul, `go.mod`)
- `proto/`: Agent-Protokoll, der einzige gemeinsame Vertrag zwischen Backend und Agent
- `specs/`: Spec-Kit-Artefakte je Feature (`NNN-name/`)

## Befehle

```bash
pnpm install
pnpm run dev:backend              # :8080
pnpm run dev:frontend             # :5173
pnpm run lint
pnpm --filter fluxip-backend cli migrate          # Migrationen anwenden (die App migriert beim Start nicht mehr)
pnpm --filter fluxip-backend cli validate-config  # Konfiguration prüfen, --online prüft Postgres, Redis, Logto
pnpm --filter fluxip-backend test
(cd agent && go test ./...)
```

Backend-Tests sind echte Integrationstests gegen Postgres und Redis (keine Mocks für Event-Store oder Queue). Vorher `docker compose up -d postgres redis` starten und `BACKEND_DATABASE_URL`/`BACKEND_REDIS_URL` setzen. Konfiguration: [docs/configuration.md](docs/configuration.md).

## Spec Kit

Features laufen über Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` (optional `/speckit-analyze`, `/speckit-checklist`, `/speckit-converge`).

- Artefakte liegen in `specs/NNN-name/` (spec, plan, research, data-model, contracts, tasks). Das aktive Feature steht in `.specify/feature.json`.
- Die Constitution in `.specify/memory/constitution.md` ist verbindlich und hat Vorrang vor ad-hoc-Anweisungen. Änderungen nur über `/speckit-constitution`.
- Nicht von Hand ändern: `.specify/templates/`, `.specify/scripts/` und `.claude/skills/speckit-*`. Das ist von Spec Kit verwalteter Code.
- Bei Arbeit an einem Feature zuerst `spec.md`, `plan.md` und `tasks.md` des Features lesen. Weicht die Umsetzung davon ab, die Artefakte im selben Zug anpassen.
- Kleine Fixes und Doku-Änderungen brauchen kein Spec-Kit-Feature.

## Regeln aus der Constitution

- **Keine automatischen Commits.** Nur committen, wenn ausdrücklich verlangt. Message im Conventional-Commits-Stil, abgeleitet aus Diff und `git log --oneline -10`.
- **Twelve-Factor** gilt für neuen und geänderten Code (Config nur per Umgebungsvariablen, Logs auf stdout, zustandslose Prozesse, Migrationen als One-off). Bekannte Abweichungen stehen unten im Backlog.

## Backlog

- [docs/12-factor-backlog.md](docs/12-factor-backlog.md): Abweichungen von den 12-Factor-Kriterien mit Beleg, Soll und Priorität. Vor Arbeiten an Logging, Migrationen, CI/Release, Shutdown, Konfiguration oder Skalierung prüfen, ob dort ein passender Punkt steht, und erledigte Punkte dort entfernen.
