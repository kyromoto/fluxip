# FluxIP

**Your home IP changed. Everything that depends on it follows — automatically.**

Dynamic IP at home or in the office? FluxIP notices the moment your router reports a new address and updates everything that needs to know: your Hetzner DNS record, your Hetzner firewall, and the allow-lists on your Traefik servers. No scripts, no cron jobs, no locked-out admin panel after the provider reassigns your address.

## Why you'll like it

- **Works with the router you already have.** A FritzBox (or anything that speaks DynDNS) reports its IP to FluxIP, nothing to install at home.
- **One change, all consequences.** Attach as many actions as you like to a device: update a DNS record, open a firewall rule, refresh a Traefik allow-list.
- **Calm when the line is not.** Flapping connections are smoothed out, failed actions are retried with backoff, and you get an email when something needs attention.
- **See what happened.** Every IP change and every action run lands in a history you can browse, so "why can't I reach my server?" has an answer.
- **Guided setup.** Adding a device or an action is a short step-by-step flow, with a UI that follows your light or dark mode.
- **Safe by design.** Sign-in is handled by [Logto](https://logto.io/), provider tokens are encrypted at rest, and Traefik agents only connect outbound, so you open no ports.
- **Yours to run.** Self-hosted with Docker Compose, multi-tenant, and open about its internals (see [Architecture](docs/architecture.md)).

## Quickstart

Prerequisites: Docker + Docker Compose, and a Hetzner DNS zone with an existing A/AAAA record plus a Hetzner **Cloud API** token for it (for the DNS-Update Action — tokens from the older DNS Console/API are not accepted).

```bash
cp .env.example .env     # fill in the required values, see docs/configuration.md
cp docker-compose.example.yml docker-compose.yml   # local copy, gitignored
docker compose up -d     # Postgres, Redis, Logto, backend (:8080), frontend (:3000)
```

The `migrate` service of the Compose file applies the database migrations once and exits before the backend starts; `backend` and `frontend` report their health (`docker compose ps`). The backend no longer migrates on startup: against an outdated schema it stops with a message naming the migration command. Outside Compose, run `node backend/dist/cli.js migrate` before starting a new version, and check a configuration before deploying it with `node backend/dist/cli.js validate-config [--online]` (see [docs/development.md](docs/development.md#admin-cli)). For local development without Docker for the app itself, see [docs/development.md](docs/development.md).

## Documentation

| Topic | Where |
|---|---|
| Architecture overview | [docs/architecture.md](docs/architecture.md) |
| Environment variables (backend, frontend runtime, `vite dev`) | [docs/configuration.md](docs/configuration.md) |
| Traefik agents (setup, template data, operating notes) | [docs/traefik-agents.md](docs/traefik-agents.md) |
| Local development, testing, project structure | [docs/development.md](docs/development.md) |
| Release process and versioning | [docs/release.md](docs/release.md) |
| Known deviations from the 12-factor criteria | [docs/12-factor-backlog.md](docs/12-factor-backlog.md) |
| Feature specs, plans and contracts | [`specs/`](specs/) |
