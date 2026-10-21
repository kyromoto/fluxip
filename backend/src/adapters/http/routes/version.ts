import { Hono } from "hono";
import type { Config } from "../../../config/env.js";

/** The release this backend is running, so the GUI can show which version it is talking to. */
export function createVersionRoutes(deps: { config: Config }): Hono {
  const router = new Hono();
  router.get("/", (c) => c.json({ version: deps.config.version }));
  return router;
}
