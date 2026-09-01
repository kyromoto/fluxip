import { serve } from "@hono/node-server";
import { Pool } from "pg";
import { runMigrations } from "./adapters/event-store-postgres/migrate.js";
import { PostgresEventStore } from "./adapters/event-store-postgres/postgres-event-store.js";
import { createApp } from "./adapters/http/app.js";
import {
  createActionExecutionQueue,
  createDebounceQueue,
  getRedisConnection,
} from "./adapters/queue-bullmq/queue.js";
import { createDebounceWorker } from "./adapters/queue-bullmq/debounce-worker.js";
import { createActionExecutionWorker } from "./adapters/queue-bullmq/action-execution-worker.js";
import { HetznerDnsExecutor } from "./adapters/actions/hetzner-dns/hetzner-dns-executor.js";
import { HetznerFirewallExecutor } from "./adapters/actions/hetzner-firewall/hetzner-firewall-executor.js";
import { EmailNotifier } from "./adapters/notifications-email/email-notifier.js";
import { loadConfig } from "./config/env.js";
import { AccountClosureService } from "./domain/account/account-closure-service.js";
import { AccountService } from "./domain/account/account-service.js";
import { getAppLogger } from "./observability/app-logger.js";
import { configureLogging, disposeLogging } from "./observability/logging.js";

const logger = getAppLogger(["startup"]);

async function main(): Promise<void> {
  const config = loadConfig();
  await configureLogging(config);

  const pool = new Pool({ connectionString: config.databaseUrl });
  await runMigrations(pool);

  const eventStore = new PostgresEventStore(pool);
  const redis = getRedisConnection(config);
  const accountService = new AccountService(eventStore, config);

  const debounceQueue = createDebounceQueue(config);
  const actionExecutionQueue = createActionExecutionQueue(config);

  const accountClosureService = new AccountClosureService({
    eventStore,
    config,
    redis,
    debounceQueue,
    actionExecutionQueue,
  });

  const hetznerDnsExecutor = new HetznerDnsExecutor();
  const hetznerFirewallExecutor = new HetznerFirewallExecutor(redis);
  const emailNotifier = new EmailNotifier(config);
  const debounceWorker = createDebounceWorker({ config, eventStore, redis, actionExecutionQueue });
  const actionExecutionWorker = createActionExecutionWorker({
    config,
    eventStore,
    redis,
    executors: {
      [hetznerDnsExecutor.type]: hetznerDnsExecutor,
      [hetznerFirewallExecutor.type]: hetznerFirewallExecutor,
    },
    notificationChannels: { [emailNotifier.type]: emailNotifier },
  });

  const { app } = createApp({
    config,
    eventStore,
    redis,
    accountService,
    accountClosureService,
    debounceQueue,
    actionExecutionQueue,
  });

  // Bind IPv4 explicitly: without a hostname, Node defaults to "::" which on
  // hosts with IPv6 loopback restricted (net.ipv6.bindv6only or similar) ends
  // up IPv6-only, silently unreachable via 127.0.0.1/localhost — the process
  // logs "listening" and never receives a connection.
  serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    logger.info("FluxIP backend listening on port {port}", { port: info.port });
  });

  const shutdown = async (): Promise<void> => {
    await debounceWorker.close();
    await actionExecutionWorker.close();
    await pool.end();
    await disposeLogging();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  // Deliberately NOT routed only through getAppLogger(): this catch fires for
  // failures in loadConfig() or configureLogging() itself — i.e. exactly the
  // cases where LogTape may not be configured yet, where a logger call is a
  // silent no-op (verified: an unconfigured LogTape logger drops records
  // without emitting anything). A raw stderr write is the only way this
  // fatal failure is guaranteed to ever be seen.
  logger.fatal("Fatal error during startup: {error}", { error: err instanceof Error ? err.message : String(err) });
  process.stderr.write(`Fatal error during startup: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
