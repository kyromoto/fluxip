import { Pool } from "pg";
import { MigrationError, runMigrations } from "../adapters/event-store-postgres/migrate.js";
import { EXIT_ERROR, EXIT_OK, type CliIo, type CommandArgs } from "../cli.js";
import { describeError } from "./describe-error.js";

/**
 * Applies the pending database migrations as a one-off process. Needs only BACKEND_DATABASE_URL (not the
 * whole configuration) and starts nothing else, so it fits an init container or a release step.
 */
export async function run(_args: CommandArgs, io: CliIo): Promise<number> {
  const url = io.env.BACKEND_DATABASE_URL;
  if (!url || url.trim() === "") {
    io.stderr("Missing required environment variable: BACKEND_DATABASE_URL");
    return EXIT_ERROR;
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10_000 });
  pool.on("error", () => undefined);
  try {
    const applied = await runMigrations(pool);
    if (applied.length === 0) {
      io.stdout("up to date");
    } else {
      for (const file of applied) io.stdout(`applied ${file}`);
      io.stdout(`${applied.length} migration(s) applied`);
    }
    return EXIT_OK;
  } catch (err) {
    if (err instanceof MigrationError) {
      io.stderr(`migration ${err.filename} failed: ${describeError(err.cause)}`);
    } else {
      io.stderr(`cannot run migrations: ${describeError(err)}`);
    }
    return EXIT_ERROR;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
