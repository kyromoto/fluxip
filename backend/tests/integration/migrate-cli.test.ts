import { readdirSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationError, runMigrations } from "../../src/adapters/event-store-postgres/migrate.js";
import { EXIT_ERROR, EXIT_OK, runCli, type CliIo } from "../../src/cli.js";
import { createMigrationDir, createTempDatabase, type TempDatabase } from "../helpers/temp-database.js";

const realMigrations = join(dirname(fileURLToPath(import.meta.url)), "../../src/adapters/event-store-postgres/migrations");
const realFiles = readdirSync(realMigrations).filter((f) => f.endsWith(".sql")).sort();

function capture(env: NodeJS.ProcessEnv): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env }, out, err };
}

const applied = async (pool: Pool): Promise<string[]> =>
  (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations ORDER BY filename")).rows.map((r) => r.filename);

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const accepts = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

describe("migrations (specs/010)", () => {
  let db: TempDatabase;

  beforeEach(async () => {
    db = await createTempDatabase();
  });
  afterEach(async () => {
    await db.drop();
  });

  it("applies every migration of the build on an empty database, in order, and is a no-op the second time", async () => {
    expect(await runMigrations(db.pool)).toEqual(realFiles);
    expect(await applied(db.pool)).toEqual(realFiles);
    expect(await runMigrations(db.pool)).toEqual([]);
  });

  it("applies each migration exactly once when two runs start at the same time (SC-001)", async () => {
    const { dir, remove } = createMigrationDir({
      "0001_a.sql": "CREATE TABLE a (id int);",
      // Slow and not idempotent: without the lock the second run would try to create "b" a second time.
      "0002_b.sql": "SELECT pg_sleep(0.6); CREATE TABLE b (id int);",
      "0003_c.sql": "CREATE TABLE c (id int);",
    });
    const second = new Pool({ connectionString: db.url, max: 2 });
    try {
      const [one, two] = await Promise.all([runMigrations(db.pool, dir), runMigrations(second, dir)]);
      expect([...one, ...two].sort()).toEqual(["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
      expect(await applied(db.pool)).toEqual(["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
    } finally {
      await second.end();
      remove();
    }
  });

  it("rolls a failing migration back, names it, keeps earlier ones and skips later ones (FR-004)", async () => {
    const { dir, remove } = createMigrationDir({
      "0001_ok.sql": "CREATE TABLE ok (id int);",
      "0002_bad.sql": "CREATE TABLE half (id int); SELECT * FROM does_not_exist;",
      "0003_later.sql": "CREATE TABLE later (id int);",
    });
    try {
      const error = await runMigrations(db.pool, dir).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).filename).toBe("0002_bad.sql");
      expect(await applied(db.pool)).toEqual(["0001_ok.sql"]);
      const tables = (await db.pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => r.tablename);
      expect(tables).toContain("ok");
      expect(tables).not.toContain("half");
      expect(tables).not.toContain("later");
      // The lock is released: a fixed migration set can run right away.
      expect(await runMigrations(db.pool, dir).catch(() => "failed again")).toBe("failed again");
    } finally {
      remove();
    }
  });

  describe("the migrate command", () => {
    it("reports what it applied, then that it is up to date, and starts nothing (FR-001, FR-002, FR-019)", async () => {
      const http = await freePort();
      const agent = await freePort();
      const env = { BACKEND_DATABASE_URL: db.url, BACKEND_PORT: String(http), BACKEND_AGENT_PORT: String(agent) };
      const filesBefore = readdirSync(process.cwd()).sort();

      const first = capture(env);
      expect(await runCli(["migrate"], first.io)).toBe(EXIT_OK);
      expect(first.out).toEqual([...realFiles.map((f) => `applied ${f}`), `${realFiles.length} migration(s) applied`]);
      expect(first.err).toEqual([]);

      const second = capture(env);
      expect(await runCli(["migrate"], second.io)).toBe(EXIT_OK);
      expect(second.out).toEqual(["up to date"]);

      expect(await accepts(http)).toBe(false);
      expect(await accepts(agent)).toBe(false);
      expect(readdirSync(process.cwd()).sort()).toEqual(filesBefore);
    });

    it("needs only the database URL, not the rest of the configuration (FR-005)", async () => {
      const { io, out } = capture({ BACKEND_DATABASE_URL: db.url });
      expect(await runCli(["migrate"], io)).toBe(EXIT_OK);
      expect(out.at(-1)).toContain("migration(s) applied");
    });

    it("exits 1 and names the variable when BACKEND_DATABASE_URL is missing", async () => {
      const { io, err } = capture({});
      expect(await runCli(["migrate"], io)).toBe(EXIT_ERROR);
      expect(err.join("\n")).toContain("BACKEND_DATABASE_URL");
    });

    it("exits 1 for an unreachable database without printing the credentials", async () => {
      const { io, err, out } = capture({ BACKEND_DATABASE_URL: "postgresql://someone:s3cretpw@127.0.0.1:1/nothing" });
      expect(await runCli(["migrate"], io)).toBe(EXIT_ERROR);
      const text = [...out, ...err].join("\n");
      expect(text).not.toContain("s3cretpw");
      expect(text).toContain("cannot run migrations");
    });
  });
});
