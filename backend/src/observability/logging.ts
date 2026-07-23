import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { configure, dispose, getConsoleSink, getJsonLinesFormatter, parseLogLevel } from "@logtape/logtape";
import { getRotatingFileSink } from "@logtape/file";
import { DEFAULT_REDACT_FIELDS, redactByField } from "@logtape/redaction";
import type { Config } from "../config/env.js";

/**
 * FR-009 defense-in-depth: call sites must never log a secret directly, but
 * this is the structural backstop wrapping both sinks (contracts/logging-topology.md).
 */
export const REDACT_FIELD_PATTERNS = [...DEFAULT_REDACT_FIELDS, /authorization/i, /credential/i];

/**
 * Configures LogTape's two disjoint category trees (FR-008): `["fluxip","app"]`
 * to the console, `["fluxip","access"]` to a redacted rotating file. One
 * process-wide `configure()` call is unavoidable (LogTape has no multi-instance
 * concept — research.md §2), but no sink is ever shared between the two trees.
 */
export async function configureLogging(config: Config): Promise<void> {
  // getRotatingFileSink() does not create its parent directory (unlike Docker's
  // named-volume mount, which does) — required for the file sink to open on a bare `pnpm dev`.
  mkdirSync(dirname(config.accessLogFilePath), { recursive: true });

  // JSON lines (not the default text formatter) so correlationId and every other
  // structured property — not just message-template placeholders — are actually
  // visible in stdout: FR-004's correlation id must be grep-able, not just present
  // on the in-memory LogRecord (research.md's console-sink choice didn't mandate a formatter).
  const consoleSink = redactByField(getConsoleSink({ formatter: getJsonLinesFormatter() }), REDACT_FIELD_PATTERNS);
  const accessFileSink = redactByField(
    getRotatingFileSink(config.accessLogFilePath, {
      maxSize: config.accessLogMaxSizeBytes,
      maxFiles: config.accessLogMaxFiles,
      nonBlocking: true,
    }),
    REDACT_FIELD_PATTERNS,
  );

  await configure({
    reset: true,
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
      console: consoleSink,
      accessFile: accessFileSink,
    },
    loggers: [
      { category: ["fluxip", "app"], sinks: ["console"], lowestLevel: parseLogLevel(config.appLogLevel) },
      { category: ["fluxip", "access"], sinks: ["accessFile"], lowestLevel: "info" },
      // Suppresses LogTape's own one-time informational banner (research.md's
      // sink-separation guarantee only concerns the two fluxip trees above,
      // not LogTape's own internal diagnostics category).
      { category: ["logtape", "meta"], sinks: ["console"], lowestLevel: "warning" },
    ],
  });
}

/** Flushes and closes both sinks (research.md §8) — called from main.ts's shutdown handler. */
export async function disposeLogging(): Promise<void> {
  await dispose();
}
