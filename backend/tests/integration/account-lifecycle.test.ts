import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { requireAdminRole } from "../../src/adapters/auth-logto/admin-guard.js";
import { createAccountRoutes } from "../../src/adapters/http/routes/account.js";
import { createActionsRoutes } from "../../src/adapters/http/routes/actions.js";
import { createAdminAccountsRoutes } from "../../src/adapters/http/routes/admin-accounts.js";
import { createIpClientsRoutes } from "../../src/adapters/http/routes/ip-clients.js";
import { createProviderCredentialsRoutes } from "../../src/adapters/http/routes/provider-credentials.js";
import { getRedisConnection } from "../../src/adapters/queue-bullmq/queue.js";
import { createDebounceQueue, createActionExecutionQueue } from "../../src/adapters/queue-bullmq/queue.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountClosureService } from "../../src/domain/account/account-closure-service.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { IP_CLIENT_AGGREGATE_TYPE } from "../../src/domain/ip-client/events.js";

const config = loadConfig(process.env);

/**
 * Covers the rest of Phase 4 (User Story 2, T047-T053) against real
 * Postgres+Redis: IP Client enable/disable/rotate/decommission, admin
 * device-limit override + admin-guard rejection, Action
 * reconfigure/enable/disable/detach, and account closure's hard-delete purge.
 * Auth is substituted the same way as tenant-isolation.test.ts (see its
 * doc comment) since real distinct Logto user tokens aren't obtainable here.
 */
describe("Account lifecycle (User Story 2)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);
  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);
  const accountClosureService = new AccountClosureService({
    eventStore,
    config,
    redis,
    debounceQueue,
    actionExecutionQueue,
  });

  const app = new Hono();
  app.use("*", async (c, next) => {
    const tenantId = c.req.header("x-test-tenant") ?? "";
    const roles = c.req.header("x-test-roles")?.split(",").filter(Boolean) ?? [];
    c.set("auth", { tenantId, roles });
    await accountService.ensureProvisioned(tenantId);
    await next();
  });
  app.route("/ip-clients", createIpClientsRoutes({ config, eventStore, redis, accountService }));
  app.route("/provider-credentials", createProviderCredentialsRoutes({ config, eventStore }));
  app.route("/", createActionsRoutes({ config, eventStore, redis }));
  app.route("/account", createAccountRoutes({ config, accountService, accountClosureService }));

  const admin = new Hono();
  admin.use("*", async (c, next) => {
    const roles = c.req.header("x-test-roles")?.split(",").filter(Boolean) ?? [];
    c.set("auth", { tenantId: c.req.header("x-test-tenant") ?? "", roles });
    await next();
  });
  admin.use("*", requireAdminRole());
  admin.route("/", createAdminAccountsRoutes({ accountService }));
  app.route("/admin", admin);

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await debounceQueue.close();
    await actionExecutionQueue.close();
  });

  function call(tenantId: string, path: string, init?: RequestInit & { roles?: string[] }): Promise<Response> {
    const { roles, ...rest } = init ?? {};
    return app.request(path, {
      ...rest,
      headers: {
        ...rest.headers,
        "x-test-tenant": tenantId,
        ...(roles ? { "x-test-roles": roles.join(",") } : {}),
      },
    });
  }

  it("enables/disables, rotates the credential of, and decommissions an IP Client", async () => {
    const tenantId = `test-lifecycle-${Date.now()}`;
    const registerRes = await call(tenantId, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Lifecycle device" }),
    });
    const { ipClientId } = (await registerRes.json()) as { ipClientId: string };

    const disableRes = await call(tenantId, `/ip-clients/${ipClientId}/disable`, { method: "POST" });
    expect(disableRes.status).toBe(200);
    expect(((await disableRes.json()) as { status: string }).status).toBe("disabled");

    const enableRes = await call(tenantId, `/ip-clients/${ipClientId}/enable`, { method: "POST" });
    expect(enableRes.status).toBe(200);
    expect(((await enableRes.json()) as { status: string }).status).toBe("enabled");

    const rotateRes = await call(tenantId, `/ip-clients/${ipClientId}/rotate-credential`, { method: "POST" });
    expect(rotateRes.status).toBe(200);
    const rotated = (await rotateRes.json()) as { reportingCredential: { username: string; password: string } };
    expect(rotated.reportingCredential.username).toBe(ipClientId);
    expect(rotated.reportingCredential.password.length).toBeGreaterThan(0);

    const decommissionRes = await call(tenantId, `/ip-clients/${ipClientId}`, { method: "DELETE" });
    expect(decommissionRes.status).toBe(200);
    expect(((await decommissionRes.json()) as { status: string }).status).toBe("decommissioned");

    const getAfter = await call(tenantId, `/ip-clients/${ipClientId}`);
    expect(((await getAfter.json()) as { status: string }).status).toBe("decommissioned");
  });

  it("lets an admin override another account's device limit, and rejects non-admins (FR-034)", async () => {
    const targetTenant = `test-target-${Date.now()}`;
    await call(targetTenant, "/ip-clients"); // triggers account auto-provisioning

    const forbidden = await call("some-caller", `/admin/accounts/${targetTenant}/device-limit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newLimit: 10 }),
      roles: [],
    });
    expect(forbidden.status).toBe(403);

    const allowed = await call("admin-caller", `/admin/accounts/${targetTenant}/device-limit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newLimit: 10 }),
      roles: ["fluxip_admin"],
    });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as { deviceLimit: number }).deviceLimit).toBe(10);

    const account = await accountService.getState(targetTenant);
    expect(account.deviceLimit).toBe(10);
  });

  it("reconfigures, disables, and detaches an Action", async () => {
    const tenantId = `test-action-lifecycle-${Date.now()}`;
    const credRes = await call(tenantId, "/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "hetzner", label: "cred", secret: "fake-token" }),
    });
    const { credentialId } = (await credRes.json()) as { credentialId: string };

    const ipClientRes = await call(tenantId, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "device" }),
    });
    const { ipClientId } = (await ipClientRes.json()) as { ipClientId: string };

    const attachRes = await call(tenantId, `/ip-clients/${ipClientId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "update_dns_record",
        addressFamilies: ["ipv4"],
        config: { providerCredentialId: credentialId, zone: "zone1", recordName: "old.example.com" },
      }),
    });
    const { actionId } = (await attachRes.json()) as { actionId: string };

    const reconfigureRes = await call(tenantId, `/actions/${actionId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: { providerCredentialId: credentialId, zone: "zone1", recordName: "new.example.com" },
      }),
    });
    expect(reconfigureRes.status).toBe(200);

    const disableRes = await call(tenantId, `/actions/${actionId}/disable`, { method: "POST" });
    expect(disableRes.status).toBe(200);

    const detachRes = await call(tenantId, `/actions/${actionId}`, { method: "DELETE" });
    expect(detachRes.status).toBe(200);
    expect(((await detachRes.json()) as { status: string }).status).toBe("detached");
  });

  it("hard-deletes every event for a tenant on account closure (FR-032, research.md §12)", async () => {
    const tenantId = `test-closure-${Date.now()}`;
    const registerRes = await call(tenantId, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "About to be deleted" }),
    });
    expect(registerRes.status).toBe(201);

    const closeRes = await call(tenantId, "/account", { method: "DELETE" });
    expect(closeRes.status).toBe(200);

    const remaining = await eventStore.listAggregateIds({ tenantId, aggregateType: IP_CLIENT_AGGREGATE_TYPE });
    expect(remaining).toHaveLength(0);
  });
});
