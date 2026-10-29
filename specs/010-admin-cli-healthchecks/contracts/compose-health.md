# Contract: Compose-Dienste und Healthchecks

| Dienst | Zweck | Healthcheck (`CMD-SHELL`) | Abhängigkeit |
|---|---|---|---|
| `postgres` | Ereignisspeicher | bestehend (`pg_isready`) | – |
| `redis` | Queues, Projektionen | bestehend (`redis-cli ping`) | – |
| `migrate` (neu) | Einmaliger Migrationsschritt (`node backend/dist/cli.js migrate`), `restart: "no"` | keiner (läuft einmal) | `postgres` healthy |
| `app` | Backend | `wget -q -O /dev/null http://127.0.0.1:$${BACKEND_PORT:-8080}/readyz` | `postgres` healthy, `redis` healthy, `logto` started, `migrate` completed successfully |
| `frontend` | Oberfläche | `wget -q -O /dev/null http://127.0.0.1:3000/` | `app` healthy |

Parameter der neuen Healthchecks: `interval: 10s`, `timeout: 5s`, `retries: 4`, `start_period: 20s`.

## Verhalten

- `app` ist `healthy`, solange `/readyz` mit 200 antwortet (Postgres und Redis erreichbar, siehe `routes/health.ts`). Bei 503 oder ohne Antwort wird `app` nach den Wiederholungen `unhealthy` und wird wieder `healthy`, sobald die Abhängigkeit zurück ist.
- `frontend` ist `healthy`, solange `/` ausgeliefert wird. Der Test sagt nichts über das Backend.
- Das Dockerfile enthält bewusst keinen `HEALTHCHECK`: Das Image bedient mehrere Rollen.
- Ist `BACKEND_BIND_ADDRESS` auf eine Adresse außer `0.0.0.0`/`127.0.0.1` gesetzt, muss die Adresse im Healthcheck angepasst werden.
