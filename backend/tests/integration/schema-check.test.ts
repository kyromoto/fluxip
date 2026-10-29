import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSchemaCurrent, runMigrations, SchemaOutdatedError } from "../../src/adapters/event-store-postgres/migrate.js";
import { createMigrationDir, createTempDatabase, type TempDatabase } from "../helpers/temp-database.js";

describe("assertSchemaCurrent (specs/010, FR-006)", () => {
  let db: TempDatabase;
  const files = { "0001_a.sql": "CREATE TABLE a (id int);", "0002_b.sql": "CREATE TABLE b (id int);" };
  const { dir, remove } = createMigrationDir(files);

  beforeAll(async () => {
    db = await createTempDatabase();
  });
  afterAll(async () => {
    await db.drop();
    remove();
  });

  const check = (): Promise<unknown> => assertSchemaCurrent(db.pool, dir).then(() => "current", (e: unknown) => e);
  const tableNames = async (): Promise<string[]> =>
    (await db.pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => r.tablename);

  it("reports every migration as pending when the database was never migrated, and changes nothing", async () => {
    const error = await check();
    expect(error).toBeInstanceOf(SchemaOutdatedError);
    expect((error as SchemaOutdatedError).pending).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect((error as Error).message).toContain("node backend/dist/cli.js migrate");
    expect(await tableNames()).toEqual([]);
  });

  it("names only the pending migrations of a partly migrated database", async () => {
    await db.pool.query("CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    await db.pool.query("INSERT INTO schema_migrations (filename) VALUES ('0001_a.sql')");
    const error = await check();
    expect((error as SchemaOutdatedError).pending).toEqual(["0002_b.sql"]);
    expect((await db.pool.query("SELECT 1 FROM schema_migrations")).rowCount).toBe(1);
  });

  it("passes once the migrations were run", async () => {
    await runMigrations(db.pool, dir).catch(() => undefined); // 0001 is recorded but its table is missing; only the record matters
    expect(await check()).toBe("current");
  });

  it("ignores entries without a file (database newer than this build)", async () => {
    await db.pool.query("INSERT INTO schema_migrations (filename) VALUES ('9999_from_the_future.sql')");
    expect(await check()).toBe("current");
  });
});
