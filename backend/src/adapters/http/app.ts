import type { Queue } from "bullmq";
import { Hono } from "hono";
import type { Redis } from "ioredis";
import { AccountClosureService } from "../../domain/account/account-closure-service.js";
import { AccountService } from "../../domain/account/account-service.js";
import type { Config } from "../../config/env.js";
import { createAccessLogMiddleware } from "../../observability/access-log.js";
import type { ActionExecutionJobData } from "../queue-bullmq/action-execution-worker.js";
import type { DebounceJobData } from "../queue-bullmq/debounce-scheduler.js";
import type { EventStore } from "../../ports/event-store.js";
import { requireAdminRole } from "../auth-logto/admin-guard.js";
import { getAuth, oidcAuthMiddleware } from "../auth-logto/oidc-middleware.js";
import { createAccountRoutes } from "./routes/account.js";
import { createActionExecutionsRoutes } from "./routes/action-executions.js";
import { createActionRunRoutes } from "./routes/action-run.js";
import { createActionsRoutes } from "./routes/actions.js";
import { createAdminAccountsRoutes } from "./routes/admin-accounts.js";
import { createIpClientHistoryRoutes } from "./routes/ip-client-history.js";
import { createIpClientsRoutes } from "./routes/ip-clients.js";
import { createNotificationChannelRoutes } from "./routes/notification-channel.js";
import { createProviderCredentialsRoutes } from "./routes/provider-credentials.js";
import { createTriggerRoutes } from "./routes/trigger.js";
import { metricsRoute } from "./metrics-route.js";

export interface AppDependencies {
  config: Config;
  eventStore: EventStore;
  redis: Redis;
  accountService: AccountService;
  accountClosureService: AccountClosureService;
  debounceQueue: Queue<DebounceJobData>;
  actionExecutionQueue: Queue<ActionExecutionJobData>;
}

export interface CreatedApp {
  app: Hono;
  api: Hono;
}

/**
 * Assembles the Hono app. Feature routes are added to `api` (OIDC-protected)
 * or directly to `app` (public — the trigger endpoint authenticates itself
 * via the IP Client's own reporting credential, not an OIDC token).
 */
export function createApp(deps: AppDependencies): CreatedApp {
  const app = new Hono();
  // Mounted before every route (including the public trigger endpoint) so every
  // request — successful, failed, or rejected before authentication — produces
  // an Access Log entry (FR-007), independent of whether anything below logs.
  app.use("*", createAccessLogMiddleware());
  app.route("/", metricsRoute);
  app.route(
    "/",
    createTriggerRoutes({ config: deps.config, eventStore: deps.eventStore, debounceQueue: deps.debounceQueue }),
  );

  const api = new Hono();
  api.use("*", oidcAuthMiddleware(deps.config));
  api.use("*", async (c, next) => {
    const auth = getAuth(c);
    await deps.accountService.ensureProvisioned(auth.accountId);
    await next();
  });

  api.route(
    "/ip-clients",
    createIpClientsRoutes({
      config: deps.config,
      eventStore: deps.eventStore,
      redis: deps.redis,
      accountService: deps.accountService,
    }),
  );
  api.route(
    "/provider-credentials",
    createProviderCredentialsRoutes({ config: deps.config, eventStore: deps.eventStore }),
  );
  api.route(
    "/",
    createActionsRoutes({ config: deps.config, eventStore: deps.eventStore, redis: deps.redis }),
  );
  api.route("/", createActionExecutionsRoutes({ eventStore: deps.eventStore, redis: deps.redis }));
  api.route("/", createActionRunRoutes({ eventStore: deps.eventStore, actionExecutionQueue: deps.actionExecutionQueue }));
  api.route("/", createIpClientHistoryRoutes({ eventStore: deps.eventStore }));
  api.route(
    "/notification-channel",
    createNotificationChannelRoutes({ config: deps.config, eventStore: deps.eventStore }),
  );
  api.route(
    "/account",
    createAccountRoutes({
      config: deps.config,
      accountService: deps.accountService,
      accountClosureService: deps.accountClosureService,
    }),
  );

  app.route("/api", api);

  const admin = new Hono();
  admin.use("*", oidcAuthMiddleware(deps.config));
  admin.use("*", requireAdminRole());
  admin.route("/", createAdminAccountsRoutes({ accountService: deps.accountService }));
  app.route("/admin", admin);

  return { app, api };
}
