import { Hono } from "hono";
import type { Config } from "../../../config/env.js";
import { AccountClosureService } from "../../../domain/account/account-closure-service.js";
import { AccountService } from "../../../domain/account/account-service.js";
import { setUserPassword } from "../../auth-logto/logto-management-client.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface AccountRouteDeps {
  config: Config;
  accountService: AccountService;
  accountClosureService: AccountClosureService;
}

export function createAccountRoutes(deps: AccountRouteDeps): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const auth = getAuth(c);
    const state = await deps.accountService.getState(auth.accountId);
    return c.json({ accountId: state.accountId, deviceLimit: state.deviceLimit, status: state.status });
  });

  router.put("/password", async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json<{ newPassword?: string }>().catch(() => ({}) as { newPassword?: string });
    if (!body.newPassword || body.newPassword.length < 8) {
      return c.json({ error: "newPassword must be at least 8 characters" }, 400);
    }

    try {
      await setUserPassword(deps.config, auth.accountId, body.newPassword);
    } catch {
      return c.json({ error: "failed to update password" }, 502);
    }
    return c.json({ ok: true });
  });

  router.delete("/", async (c) => {
    const auth = getAuth(c);
    await deps.accountClosureService.closeAccount(auth.accountId);
    return c.json({ ok: true });
  });

  return router;
}
