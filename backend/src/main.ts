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
import { EmailNotifier } from "./adapters/notifications-email/email-notifier.js";
import { loadConfig } from "./config/env.js";
import { AccountClosureService } from "./domain/account/account-closure-service.js";
import { AccountService } from "./domain/account/account-service.js";

async function main(): Promise<void> {
  const config = loadConfig();

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
  const emailNotifier = new EmailNotifier(config);
  const debounceWorker = createDebounceWorker({ config, eventStore, actionExecutionQueue });
  const actionExecutionWorker = createActionExecutionWorker({
    config,
    eventStore,
    redis,
    executors: { [hetznerDnsExecutor.type]: hetznerDnsExecutor },
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

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`FluxIP backend listening on port ${info.port}`);
  });

  const shutdown = async (): Promise<void> => {
    await debounceWorker.close();
    await actionExecutionWorker.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
