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
 * User Story 3 (004-credential-management spec.md): a single Provider Credential entry
 * reused across multiple independent Actions, and blocked from deletion — naming every
 * referencing Action — until all of them are detached. Against real Postgres+Redis, per
 * this repo's existing testing convention (research.md §Testing). Auth is substituted the
 * same way as account-isolation.test.ts.
 */
describe("Provider Credential lifecycle: reuse across multiple Actions (User Story 3)", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);

  const app = new Hono();
  app.use("*", async (c, next) => {
    const accountId = c.req.header("x-test-account") ?? "";
    c.set("auth", { accountId, roles: [] });
    await accountService.ensureProvisioned(accountId);
    await next();
  });
  app.route("/provider-credentials", createProviderCredentialsRoutes({ config, eventStore }));
  app.route("/ip-clients", createIpClientsRoutes({ config, eventStore, redis, accountService }));
  app.route("/", createActionsRoutes({ config, eventStore, redis }));

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  function call(accountId: string, path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, { ...init, headers: { ...init?.headers, "x-test-account": accountId } });
  }

  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  it("creates one credential, attaches it to two Actions, blocks delete naming both, then allows delete once both are detached", async () => {
    const accountId = `lifecycle-${Date.now()}`;

    const credRes = await call(accountId, "/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "hetzner", label: "Shared credential", secret: "shared-token-1234" }),
    });
    expect(credRes.status).toBe(201);
    const { credentialId } = await json<{ credentialId: string }>(credRes);

    const deviceARes = await call(accountId, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Device A" }),
    });
    const { ipClientId: ipClientA } = await json<{ ipClientId: string }>(deviceARes);

    const deviceBRes = await call(accountId, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Device B" }),
    });
    const { ipClientId: ipClientB } = await json<{ ipClientId: string }>(deviceBRes);

    async function attach(ipClientId: string, recordName: string): Promise<string> {
      const res = await call(accountId, `/ip-clients/${ipClientId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "update_dns_record",
          addressFamilies: ["ipv4"],
          config: { providerCredentialId: credentialId, zone: "shared-zone", recordName },
        }),
      });
      expect(res.status).toBe(201);
      const { actionId } = await json<{ actionId: string }>(res);
      return actionId;
    }

    const actionA = await attach(ipClientA, "a.example.com");
    const actionB = await attach(ipClientB, "b.example.com");

    // Both Actions independently reference the same shared entry (FR-008/US3 AC1-2).
    const blocked = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    const blockedBody = await json<{ error: string; usedBy: { actionId: string; ipClientId: string }[] }>(blocked);
    expect(blockedBody.error).toBe("credential_in_use");
    expect(blockedBody.usedBy).toHaveLength(2);
    expect(blockedBody.usedBy.map((u) => u.actionId).sort()).toEqual([actionA, actionB].sort());

    // Detaching only one Action still leaves the credential referenced by the other.
    const detachA = await call(accountId, `/actions/${actionA}`, { method: "DELETE" });
    expect(detachA.status).toBe(200);
    const stillBlocked = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(stillBlocked.status).toBe(409);
    const stillBlockedBody = await json<{ usedBy: { actionId: string }[] }>(stillBlocked);
    expect(stillBlockedBody.usedBy).toHaveLength(1);
    expect(stillBlockedBody.usedBy[0].actionId).toBe(actionB);

    // Detaching the second Action clears the last reference; delete now succeeds.
    const detachB = await call(accountId, `/actions/${actionB}`, { method: "DELETE" });
    expect(detachB.status).toBe(200);
    const finalDelete = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(finalDelete.status).toBe(204);

    const listRes = await call(accountId, "/provider-credentials");
    const { items } = await json<{ items: unknown[] }>(listRes);
    expect(items).toHaveLength(0);
  });
});
