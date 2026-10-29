import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const defaultMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/** Session-level advisory lock that serializes migration runs of all processes on one database. */
const LOCK_KEY_SQL = "hashtext('fluxip:migrate')";

export class MigrationError extends Error {
  constructor(
    readonly filename: string,
    cause: unknown,
  ) {
    super(`migration ${filename} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "MigrationError";
    this.cause = cause;
  }
}

export class SchemaOutdatedError extends Error {
  constructor(readonly pending: string[]) {
    super(
      `Database schema is outdated: ${pending.length} pending migration(s) (${pending.join(", ")}). ` +
        "Run: node backend/dist/cli.js migrate",
    );
    this.name = "SchemaOutdatedError";
  }
}

function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Minimal, dependency-free migration runner: applies any .sql file in
 * migrations/ not yet recorded in schema_migrations, in filename order.
 *
 * The whole run holds an advisory lock, so concurrent runs (several instances, CI, the CLI) wait for each
 * other instead of colliding; a waiting run then finds nothing left to do. Returns the files applied.
 */
export async function runMigrations(pool: Pool, migrationsDir: string = defaultMigrationsDir): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK_KEY_SQL})`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const { rows } = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    const alreadyApplied = new Set(rows.map((r) => r.filename));

    const applied: string[] = [];
    for (const file of migrationFiles(migrationsDir)) {
      if (alreadyApplied.has(file)) continue;

      const sql = readFileSync(join(migrationsDir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new MigrationError(file, err);
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY_SQL})`).catch(() => undefined);
    client.release();
  }
}

/**
 * Read-only schema check for the application start: throws SchemaOutdatedError when migrations are pending.
 * Entries in schema_migrations without a file (database newer than this build) are fine.
 */
export async function assertSchemaCurrent(pool: Pool, migrationsDir: string = defaultMigrationsDir): Promise<void> {
  const present = await pool.query<{ t: string | null }>("SELECT to_regclass('schema_migrations') AS t");
  let alreadyApplied = new Set<string>();
  if (present.rows[0]?.t) {
    const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    alreadyApplied = new Set(rows.map((r) => r.filename));
  }
  const pending = migrationFiles(migrationsDir).filter((f) => !alreadyApplied.has(f));
  if (pending.length > 0) throw new SchemaOutdatedError(pending);
}
