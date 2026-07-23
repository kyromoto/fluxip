import type { Context, Next } from "hono";
import { getAuth } from "./oidc-middleware.js";

/**
 * The role/claim an operator assigns out-of-band in Logto's own console to grant
 * Administrator capability (research.md §16) — FluxIP never grants or manages
 * this itself in this iteration, it only checks for it on the verified token.
 */
export const ADMIN_ROLE_CLAIM = "fluxip_admin";

export function requireAdminRole() {
  return async (c: Context, next: Next) => {
    const auth = getAuth(c);
    if (!auth.roles.includes(ADMIN_ROLE_CLAIM)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  };
}
