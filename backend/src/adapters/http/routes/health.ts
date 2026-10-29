import { Hono } from "hono";

export interface HealthRoutesDeps {
  /** Each check rejects when its backing service is unreachable. */
  checks: Record<string, () => Promise<unknown>>;
}

/**
 * `/healthz` is liveness (the process answers). `/readyz` is readiness: it
 * answers 503 while a backing service (Postgres, Redis) is unreachable.
 * Both are public and expose no details beyond the name of the failing check.
 */
export function createHealthRoutes({ checks }: HealthRoutesDeps): Hono {
  const routes = new Hono();

  routes.get("/healthz", (c) => c.json({ status: "ok" }));

  routes.get("/readyz", async (c) => {
    const results = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await Promise.race([
            check(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000).unref()),
          ]);
          return [name, "ok"] as const;
        } catch {
          return [name, "unavailable"] as const;
        }
      }),
    );
    const body = Object.fromEntries(results);
    const ready = results.every(([, status]) => status === "ok");
    return c.json({ status: ready ? "ok" : "unavailable", checks: body }, ready ? 200 : 503);
  });

  return routes;
}
