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
 * Contract tests for the Provider Credentials API (contracts/provider-credentials-api.md),
 * against real Postgres, per this repo's existing testing convention (research.md §Testing).
 */
describe("Provider Credentials API", () => {
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

  function post(accountId: string, body: unknown): Promise<Response> {
    return call(accountId, "/provider-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects a POST missing required fields (400)", async () => {
    const accountId = `contract-missing-${Date.now()}`;
    const res = await post(accountId, { provider: "hetzner", label: "No secret" });
    expect(res.status).toBe(400);
  });

  it("stores a credential and never returns the full secret, only secretLast4 + provider (FR-004a)", async () => {
    const accountId = `contract-store-${Date.now()}`;
    const createRes = await post(accountId, { provider: "hetzner", label: "Hauptaccount", secret: "s3cr3t-token-9999" });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.secretLast4).toBe("9999");
    expect(JSON.stringify(created)).not.toContain("s3cr3t-token-9999");

    const listRes = await call(accountId, "/provider-credentials");
    const { items } = (await listRes.json()) as { items: Record<string, unknown>[] };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ provider: "hetzner", label: "Hauptaccount", secretLast4: "9999" });
    expect(JSON.stringify(items)).not.toContain("s3cr3t-token-9999");
  });

  it("rejects a case-insensitive duplicate label for the same account (409, FR-003)", async () => {
    const accountId = `contract-dup-${Date.now()}`;
    const first = await post(accountId, { provider: "hetzner", label: "Hauptaccount", secret: "token-aaaa" });
    expect(first.status).toBe(201);

    const dup = await post(accountId, { provider: "hetzner", label: "HAUPTACCOUNT", secret: "token-bbbb" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "label already in use" });

    const differentName = await post(accountId, { provider: "hetzner", label: "Kundenprojekt X", secret: "token-cccc" });
    expect(differentName.status).toBe(201);
  });

  it("supports at least 5 simultaneously active, distinctly named entries (SC-006)", async () => {
    const accountId = `contract-scale-${Date.now()}`;
    for (let i = 1; i <= 5; i += 1) {
      const res = await post(accountId, { provider: "hetzner", label: `Hetzner project ${i}`, secret: `token-${i}` });
      expect(res.status).toBe(201);
    }
    const listRes = await call(accountId, "/provider-credentials");
    const { items } = (await listRes.json()) as { items: { label: string }[] };
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.label)).size).toBe(5);
  });

  it("deletes an unreferenced, owned, active entry (204)", async () => {
    const accountId = `contract-delete-${Date.now()}`;
    const createRes = await post(accountId, { provider: "hetzner", label: "Disposable", secret: "token-dddd" });
    const { credentialId } = (await createRes.json()) as { credentialId: string };

    const deleteRes = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const listRes = await call(accountId, "/provider-credentials");
    const { items } = (await listRes.json()) as { items: unknown[] };
    expect(items).toHaveLength(0);
  });

  it("404s deleting a missing, foreign, or already-revoked entry (FR-014)", async () => {
    const accountId = `contract-404-a-${Date.now()}`;
    const otherAccountId = `contract-404-b-${Date.now()}`;

    const missing = await call(accountId, "/provider-credentials/does-not-exist", { method: "DELETE" });
    expect(missing.status).toBe(404);

    const createRes = await post(accountId, { provider: "hetzner", label: "Owned by A", secret: "token-eeee" });
    const { credentialId } = (await createRes.json()) as { credentialId: string };

    const foreign = await call(otherAccountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(foreign.status).toBe(404);

    const firstDelete = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(firstDelete.status).toBe(204);

    const secondDelete = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(secondDelete.status).toBe(404);
  });

  it("blocks deleting a credential referenced by an Action, naming it, then allows deletion once detached (409/204, FR-010, US3)", async () => {
    const accountId = `contract-blocked-${Date.now()}`;

    const credRes = await post(accountId, { provider: "hetzner", label: "In-use credential", secret: "token-ffff" });
    const { credentialId } = (await credRes.json()) as { credentialId: string };

    const ipClientRes = await call(accountId, "/ip-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Blocked-delete test device" }),
    });
    const { ipClientId } = (await ipClientRes.json()) as { ipClientId: string };

    const attachRes = await call(accountId, `/ip-clients/${ipClientId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "hetzner_cloud_dns_update",
        addressFamilies: ["ipv4"],
        config: { providerCredentialId: credentialId, zone: "zone1", recordName: "blocked.example.com" },
      }),
    });
    expect(attachRes.status).toBe(201);
    const { actionId } = (await attachRes.json()) as { actionId: string };

    const blockedDelete = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(blockedDelete.status).toBe(409);
    const blockedBody = (await blockedDelete.json()) as { error: string; usedBy: { actionId: string }[] };
    expect(blockedBody.error).toBe("credential_in_use");
    expect(blockedBody.usedBy).toContainEqual(
      expect.objectContaining({ actionId, ipClientId, zone: "zone1", recordName: "blocked.example.com" }),
    );

    // Disabling (but not detaching) the Action still counts as a reference (FR-010 — enabled or disabled).
    const disableRes = await call(accountId, `/actions/${actionId}/disable`, { method: "POST" });
    expect(disableRes.status).toBe(200);
    const stillBlocked = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(stillBlocked.status).toBe(409);

    const detachRes = await call(accountId, `/actions/${actionId}`, { method: "DELETE" });
    expect(detachRes.status).toBe(200);

    const nowDeletable = await call(accountId, `/provider-credentials/${credentialId}`, { method: "DELETE" });
    expect(nowDeletable.status).toBe(204);
  });
});
