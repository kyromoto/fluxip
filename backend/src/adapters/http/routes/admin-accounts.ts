import { Hono } from "hono";
import { AccountService } from "../../../domain/account/account-service.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface AdminAccountsRouteDeps {
  accountService: AccountService;
}

/** Mounted under /admin, itself behind oidcAuthMiddleware + requireAdminRole (see app.ts). */
export function createAdminAccountsRoutes(deps: AdminAccountsRouteDeps): Hono {
  const router = new Hono();

  router.post("/accounts/:accountId/device-limit", async (c) => {
    const auth = getAuth(c);
    const accountId = c.req.param("accountId");
    const body = await c.req.json<{ newLimit?: number }>().catch(() => ({}) as { newLimit?: number });

    if (typeof body.newLimit !== "number" || !Number.isInteger(body.newLimit) || body.newLimit < 0) {
      return c.json({ error: "newLimit must be a non-negative integer" }, 400);
    }

    const updated = await deps.accountService.overrideDeviceLimit(accountId, body.newLimit, auth.tenantId);
    if (!updated) {
      return c.json({ error: "account not found" }, 404);
    }
    return c.json({ accountId, deviceLimit: updated.deviceLimit });
  });

  return router;
}
