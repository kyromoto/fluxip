import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { ulid } from "ulid";

export interface TempDatabase {
  url: string;
  pool: Pool;
  drop(): Promise<void>;
}

/**
 * A throwaway database on the server BACKEND_DATABASE_URL points to, so migration tests can start from an
 * empty schema without touching the database the other integration tests share.
 */
export async function createTempDatabase(): Promise<TempDatabase> {
  const baseUrl = process.env.BACKEND_DATABASE_URL;
  if (!baseUrl) throw new Error("BACKEND_DATABASE_URL must be set for integration tests");
  const name = `fluxip_t_${ulid().toLowerCase()}`;

  const admin = new Pool({ connectionString: baseUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 4 });

  return {
    url: url.toString(),
    pool,
    async drop() {
      await pool.end();
      const cleanup = new Pool({ connectionString: baseUrl, max: 1 });
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

/** Writes the given migration files into a fresh temporary directory; returns it and a remover. */
export function createMigrationDir(files: Record<string, string>): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "fluxip-migrations-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
