import { Pool } from "pg";
import { getAppLogger } from "../../observability/app-logger.js";

const logger = getAppLogger(["postgres"]);

/**
 * The application's Postgres pool. When the server goes away, idle connections emit "error" events; without
 * a listener Node treats that as an uncaught exception and the whole process dies. The pool reconnects on
 * the next query, so this only logs: /readyz then answers 503 (container "unhealthy") until Postgres is back,
 * and the process recovers by itself.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString });
  pool.on("error", (err) => {
    logger.error("Postgres connection error: {error}", { error: err.message });
  });
  return pool;
}
