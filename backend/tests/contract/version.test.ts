import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createVersionRoutes } from "../../src/adapters/http/routes/version.js";
import { loadConfig } from "../../src/config/env.js";

const base = {
  BACKEND_CLOUDEVENTS_SOURCE: "https://fluxip.test",
  BACKEND_CLOUDEVENTS_TYPE_PREFIX: "test.fluxip",
  BACKEND_DATABASE_URL: "postgresql://unused",
  BACKEND_REDIS_URL: "redis://unused",
  BACKEND_LOGTO_ENDPOINT: "https://logto.test",
  BACKEND_CREDENTIAL_ENCRYPTION_KEY: "unused",
};

function appFor(env: Record<string, string>) {
  const app = new Hono();
  app.route("/version", createVersionRoutes({ config: loadConfig({ ...base, ...env }) }));
  return app;
}

describe("GET /api/version", () => {
  it("reports the version baked into the image", async () => {
    const res = await appFor({ FLUXIP_VERSION: "1.4.2" }).request("/version");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "1.4.2" });
  });

  it("reports 'dev' outside a release build, also for a blank value", async () => {
    expect(await (await appFor({}).request("/version")).json()).toEqual({ version: "dev" });
    expect(await (await appFor({ FLUXIP_VERSION: "  " }).request("/version")).json()).toEqual({ version: "dev" });
  });
});
