import { Hono } from "hono";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "../../src/adapters/event-store-postgres/postgres-event-store.js";
import { SessionRegistry } from "../../src/adapters/agent-grpc/session-registry.js";
import { createTraefikProvidersRoutes } from "../../src/adapters/http/routes/traefik-providers.js";
import { loadConfig } from "../../src/config/env.js";
import { AccountService } from "../../src/domain/account/account-service.js";
import { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";

const config = { ...loadConfig(process.env), agentPublicUrl: "https://agents.example.com" };

/** Contract tests for contracts/management-api.md (providers), against real Postgres like the other contract tests. */
describe("Traefik providers API", () => {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const eventStore = new PostgresEventStore(pool);
  const accountService = new AccountService(eventStore, config);
  const store = new ProviderStore(eventStore, config);
  const registry = new SessionRegistry();

  const app = new Hono();
  app.use("*", async (c, next) => {
    const accountId = c.req.header("x-test-account") ?? "";
    c.set("auth", { accountId, roles: [] });
    await accountService.ensureProvisioned(accountId);
    await next();
  });
  app.route("/agents", createTraefikProvidersRoutes({ config, eventStore, store, registry }));

  beforeAll(async () => {
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  const unique = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  function call(accountId: string, path: string, init?: RequestInit): Promise<Response> {
    return app.request(`/agents${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers, "x-test-account": accountId } });
  }
  const post = (accountId: string, body: unknown, path = "") => call(accountId, path, { method: "POST", body: JSON.stringify(body) });

  it("creates a provider and shows the token and setup exactly once (US1-1)", async () => {
    const accountId = unique("create");
    const res = await post(accountId, { name: "Standort Nord" });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      providerId: string;
      connectionMode: string;
      agentAddress: string;
      token: { tokenId: string; value: string; last4: string };
      setup: { startCommand: string; traefikSnippet: string; notes: string[] };
    };
    expect(created.connectionMode).toBe("agent_initiated");
    expect(created.agentAddress).toBe(`https://agents.example.com/${created.providerId}`);
    expect(created.token.value).toMatch(/^fxt_/);
    expect(created.setup.startCommand).toContain(created.agentAddress);
    expect(created.setup.startCommand).toContain(created.token.value);
    expect(created.setup.traefikSnippet).toContain("watch: true");
    expect(created.setup.notes.length).toBeGreaterThan(0);

    const list = (await (await call(accountId, "")).json()) as { items: Record<string, unknown>[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ providerId: created.providerId, name: "Standort Nord", state: "never_connected", actionCount: 0 });
    expect(JSON.stringify(list)).not.toContain(created.token.value);
    expect((list.items[0] as { tokens: { last4: string; status: string }[] }).tokens).toEqual([
      expect.objectContaining({ tokenId: created.token.tokenId, last4: created.token.last4, status: "valid" }),
    ]);
  });

  it("gives every provider its own address and token", async () => {
    const accountId = unique("two");
    const a = (await (await post(accountId, { name: "A" })).json()) as { agentAddress: string; token: { value: string } };
    const b = (await (await post(accountId, { name: "B" })).json()) as { agentAddress: string; token: { value: string } };
    expect(a.agentAddress).not.toBe(b.agentAddress);
    expect(a.token.value).not.toBe(b.token.value);
  });

  it("rejects a missing name (400) and a duplicate name, ignoring case (409)", async () => {
    const accountId = unique("name");
    expect((await post(accountId, {})).status).toBe(400);
    expect((await post(accountId, { name: "   " })).status).toBe(400);
    expect((await post(accountId, { name: "Nord" })).status).toBe(201);
    const dup = await post(accountId, { name: "NORD" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "name_in_use" });
  });

  it("renames via PATCH and keeps the connection mode immutable", async () => {
    const accountId = unique("patch");
    const created = (await (await post(accountId, { name: "Alt" })).json()) as { providerId: string };
    const res = await call(accountId, `/${created.providerId}`, { method: "PATCH", body: JSON.stringify({ name: "Neu" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Neu" });

    const immutable = await call(accountId, `/${created.providerId}`, { method: "PATCH", body: JSON.stringify({ name: "Neu", connectionMode: "server_initiated" }) });
    expect(immutable.status).toBe(422);
    expect(await immutable.json()).toMatchObject({ error: "immutable_field" });
  });

  it("rejects connection mode server_initiated with a clear message (US8-2)", async () => {
    const res = await post(unique("modeb"), { name: "B", connectionMode: "server_initiated" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "connection_mode_not_available" });
  });

  it("never exposes another account's provider (404, FR-004)", async () => {
    const owner = unique("owner");
    const stranger = unique("stranger");
    const created = (await (await post(owner, { name: "Mine" })).json()) as { providerId: string };
    expect((await call(stranger, `/${created.providerId}`)).status).toBe(404);
    expect((await call(stranger, `/${created.providerId}`, { method: "DELETE" })).status).toBe(404);
    expect((await post(stranger, {}, `/${created.providerId}/tokens`)).status).toBe(404);
    const list = (await (await call(stranger, "")).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(0);
  });

  it("issues a second token, refuses a third, and revokes idempotently (US7-1)", async () => {
    const accountId = unique("tokens");
    const created = (await (await post(accountId, { name: "T" })).json()) as { providerId: string; token: { tokenId: string } };
    const second = await post(accountId, {}, `/${created.providerId}/tokens`);
    expect(second.status).toBe(201);
    expect(((await second.json()) as { value: string }).value).toMatch(/^fxt_/);

    const third = await post(accountId, {}, `/${created.providerId}/tokens`);
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: "token_limit_reached" });

    const revoke = () => call(accountId, `/${created.providerId}/tokens/${created.token.tokenId}`, { method: "DELETE" });
    expect((await revoke()).status).toBe(204);
    expect((await revoke()).status).toBe(204);
    expect((await call(accountId, `/${created.providerId}/tokens/unknown`, { method: "DELETE" })).status).toBe(404);

    const detail = (await (await call(accountId, `/${created.providerId}`)).json()) as { tokens: { status: string }[] };
    expect(detail.tokens.map((t) => t.status).sort()).toEqual(["revoked", "valid"]);
    expect((await post(accountId, {}, `/${created.providerId}/tokens`)).status).toBe(201);
  });

  it("deletes an unused provider (204) and then reports it as gone", async () => {
    const accountId = unique("delete");
    const created = (await (await post(accountId, { name: "Weg" })).json()) as { providerId: string };
    expect((await call(accountId, `/${created.providerId}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(accountId, `/${created.providerId}`)).status).toBe(404);
    expect(((await (await call(accountId, "")).json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});
