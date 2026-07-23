import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { createActionsRoutes } from "../../src/adapters/http/routes/actions.js";
import { createIpClientsRoutes } from "../../src/adapters/http/routes/ip-clients.js";
import { createProviderCredentialsRoutes } from "../../src/adapters/http/routes/provider-credentials.js";
import { getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountService } from "../../src/domain/account/account-service.js";

const config = loadConfig(process.env);

/**
 * Validates tenant isolation (quickstart.md Scenario 2 / FR-012, FR-013, SC-003)
 * at the real route/business-logic layer against real Postgres+Redis. JWT
 * verification itself was already validated against the real Logto instance
 * in T046; a client-credentials M2M grant always yields the same fixed
 * subject, so two genuinely distinct human Logto users aren't obtainable in
 * this non-interactive environment — this test substitutes the auth
 * middleware with a trivial per-request tenant header so two truly separate
 * tenants can be exercised, while everything downstream (routes, tenant
 * scoping, aggregate ownership checks) is the real production code.
 */
describe("Tenant isolation across two accounts", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);

  const app = new Hono();
  app.use("*", async (c, next) => {
    const tenantId = c.req.header("x-test-tenant") ?? "";
    c.set("auth", { tenantId, roles: [] });
    await accountService.ensureProvisioned(tenantId);
    await next();
  });
  app.route("/ip-clients", createIpClientsRoutes({ config, eventStore, redis, accountService }));
  app.route("/provider-credentials", createProviderCredentialsRoutes({ config, eventStore }));
  app.route("/", createActionsRoutes({ config, eventStore, redis }));

  const tenantA = `test-tenant-a-${Date.now()}`;
  const tenantB = `test-tenant-b-${Date.now()}`;

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function call(tenantId: string, path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, { ...init, headers: { ...init?.headers, "x-test-tenant": tenantId } });
  }

  it("hides tenant A's IP Client from tenant B (404, not 403)", async () => {
    const registerRes = await call(tenantA, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Tenant A device" }),
    });
    expect(registerRes.status).toBe(201);
    const { ipClientId } = (await registerRes.json()) as { ipClientId: string };

    const asOwner = await call(tenantA, `/ip-clients/${ipClientId}`);
    expect(asOwner.status).toBe(200);

    const asOther = await call(tenantB, `/ip-clients/${ipClientId}`);
    expect(asOther.status).toBe(404);
  });

  it("never lists tenant A's Provider Credentials for tenant B", async () => {
    const storeRes = await call(tenantA, "/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "hetzner", label: "Tenant A cred", secret: "fake-token" }),
    });
    expect(storeRes.status).toBe(201);

    const listAsOther = await call(tenantB, "/provider-credentials");
    const { items } = (await listAsOther.json()) as { items: { label: string }[] };
    expect(items.some((i) => i.label === "Tenant A cred")).toBe(false);

    const listAsOwner = await call(tenantA, "/provider-credentials");
    const ownerItems = (await listAsOwner.json()) as { items: { label: string }[] };
    expect(ownerItems.items.some((i) => i.label === "Tenant A cred")).toBe(true);
  });

  it("rejects an Action referencing another tenant's Provider Credential (FR-013)", async () => {
    const credRes = await call(tenantA, "/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "hetzner", label: "Cross-tenant test cred", secret: "fake-token" }),
    });
    const { credentialId } = (await credRes.json()) as { credentialId: string };

    const ipClientRes = await call(tenantB, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Tenant B device" }),
    });
    const { ipClientId } = (await ipClientRes.json()) as { ipClientId: string };

    const attachRes = await call(tenantB, `/ip-clients/${ipClientId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "update_dns_record",
        addressFamilies: ["ipv4"],
        config: { providerCredentialId: credentialId, zone: "zone1", recordName: "home.example.com" },
      }),
    });
    expect(attachRes.status).toBe(400);
  });
});
