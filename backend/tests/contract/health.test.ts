import { describe, expect, it } from "vitest";
import { createHealthRoutes } from "../../src/adapters/http/routes/health.js";

describe("health endpoints", () => {
  it("/healthz answers ok without consulting backing services", async () => {
    const app = createHealthRoutes({ checks: { postgres: () => Promise.reject(new Error("down")) } });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("/readyz is 200 when every check passes", async () => {
    const app = createHealthRoutes({ checks: { postgres: async () => 1, redis: async () => "PONG" } });
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", checks: { postgres: "ok", redis: "ok" } });
  });

  it("/readyz is 503 and names the failing check without leaking the error", async () => {
    const app = createHealthRoutes({
      checks: { postgres: async () => 1, redis: () => Promise.reject(new Error("secret host:6379")) },
    });
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable", checks: { postgres: "ok", redis: "unavailable" } });
  });
});
