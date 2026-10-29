import { collectConfigProblems } from "./env.js";

export interface ConfigFinding {
  name: string;
  level: "error" | "warning";
  /** Short and value-free: never contains the content of a variable. */
  reason: string;
  /** For warnings: what stops working because of it. */
  feature?: string;
}

/**
 * Every variable `loadConfig` reads. `true`: `checkConfig` looks at it. A string: deliberately not checked,
 * with the reason. A test keeps this in step with `loadConfig`, so a new variable cannot be forgotten here.
 */
export const KNOWN_VARS: Record<string, true | string> = {
  BACKEND_CLOUDEVENTS_SOURCE: true,
  BACKEND_CLOUDEVENTS_TYPE_PREFIX: true,
  BACKEND_DEFAULT_IP_CLIENT_LIMIT: true,
  BACKEND_ACTION_RETRY_ATTEMPTS: true,
  BACKEND_ACTION_RETRY_BASE_DELAY_MS: true,
  BACKEND_IP_CLIENT_DEBOUNCE_MS: true,
  BACKEND_DATABASE_URL: true,
  BACKEND_REDIS_URL: true,
  BACKEND_LOGTO_ENDPOINT: true,
  BACKEND_LOGTO_APP_ID: "not used by the backend",
  BACKEND_LOGTO_APP_SECRET: "not used by the backend",
  BACKEND_LOGTO_MANAGEMENT_CLIENT_ID: true,
  BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET: true,
  BACKEND_LOGTO_MANAGEMENT_API_BASE_URL: true,
  BACKEND_PORT: true,
  BACKEND_BIND_ADDRESS: "any value is accepted",
  BACKEND_CREDENTIAL_ENCRYPTION_KEY: true,
  BACKEND_SMTP_HOST: true,
  BACKEND_SMTP_PORT: true,
  BACKEND_SMTP_USER: "optional credential",
  BACKEND_SMTP_PASSWORD: "optional credential",
  BACKEND_SMTP_SECURE: true,
  BACKEND_NOTIFICATION_FROM_ADDRESS: true,
  BACKEND_APP_LOG_LEVEL: true,
  BACKEND_ACCESS_LOG_FILE_PATH: "any path is accepted",
  BACKEND_ACCESS_LOG_MAX_SIZE_BYTES: true,
  BACKEND_ACCESS_LOG_MAX_FILES: true,
  BACKEND_AGENT_PORT: true,
  BACKEND_AGENT_PUBLIC_URL: true,
  BACKEND_AGENT_SNAPSHOT_MAX_BYTES: true,
  BACKEND_AGENT_SNAPSHOT_COALESCE_MS: true,
  BACKEND_AGENT_RESYNC_MS: true,
  BACKEND_AGENT_HEARTBEAT_SECONDS: true,
  FLUXIP_VERSION: "set by the image build",
};

const INTEGERS: Record<string, { min: number; max?: number }> = {
  BACKEND_DEFAULT_IP_CLIENT_LIMIT: { min: 0 },
  BACKEND_ACTION_RETRY_ATTEMPTS: { min: 0 },
  BACKEND_ACTION_RETRY_BASE_DELAY_MS: { min: 0 },
  BACKEND_IP_CLIENT_DEBOUNCE_MS: { min: 0 },
  BACKEND_PORT: { min: 1, max: 65535 },
  BACKEND_SMTP_PORT: { min: 1, max: 65535 },
  BACKEND_ACCESS_LOG_MAX_SIZE_BYTES: { min: 0 },
  BACKEND_ACCESS_LOG_MAX_FILES: { min: 0 },
  BACKEND_AGENT_PORT: { min: 1, max: 65535 },
  BACKEND_AGENT_SNAPSHOT_MAX_BYTES: { min: 0 },
  BACKEND_AGENT_SNAPSHOT_COALESCE_MS: { min: 0 },
  BACKEND_AGENT_RESYNC_MS: { min: 0 },
  BACKEND_AGENT_HEARTBEAT_SECONDS: { min: 0 },
};

const URLS: Record<string, { protocols: string[]; required: boolean }> = {
  BACKEND_DATABASE_URL: { protocols: ["postgres:", "postgresql:"], required: true },
  BACKEND_REDIS_URL: { protocols: ["redis:", "rediss:"], required: true },
  BACKEND_LOGTO_ENDPOINT: { protocols: ["http:", "https:"], required: true },
  BACKEND_LOGTO_MANAGEMENT_API_BASE_URL: { protocols: ["http:", "https:"], required: false },
  BACKEND_AGENT_PUBLIC_URL: { protocols: ["http:", "https:"], required: false },
};

const LOG_LEVELS = ["trace", "debug", "info", "warning", "error", "fatal"];

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === "";

function isValidKey(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;
}

function urlProblem(value: string, protocols: string[]): string | null {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) ? null : `unexpected scheme (expected ${protocols.map((p) => p.slice(0, -1)).join(" or ")})`;
  } catch {
    return "not a valid URL";
  }
}

/**
 * Checks the configuration the way the application would read it, but reports everything wrong at once and
 * never repeats a value. Errors are what stops the application or breaks core behaviour; warnings are
 * optional features that will not work with the current values.
 */
export function checkConfig(env: NodeJS.ProcessEnv = process.env): ConfigFinding[] {
  const errors: ConfigFinding[] = [];
  const warnings: ConfigFinding[] = [];
  const failed = new Set<string>();
  const error = (name: string, reason: string): void => {
    failed.add(name);
    errors.push({ name, level: "error", reason });
  };
  const warn = (name: string, reason: string, feature: string): void => {
    warnings.push({ name, level: "warning", reason, feature });
  };

  for (const problem of collectConfigProblems(env)) {
    error(problem.name, problem.kind === "missing" ? "missing" : "not an integer");
  }

  for (const [name, { min, max }] of Object.entries(INTEGERS)) {
    const value = env[name];
    if (failed.has(name) || isBlank(value)) continue;
    const text = (value as string).trim();
    if (!/^-?\d+$/.test(text)) error(name, "not an integer");
    else if (Number(text) < min || (max !== undefined && Number(text) > max)) {
      error(name, max === undefined ? `must be at least ${min}` : `must be between ${min} and ${max}`);
    }
  }

  for (const [name, { protocols, required }] of Object.entries(URLS)) {
    const value = env[name];
    if (failed.has(name) || (isBlank(value) && !required)) continue;
    const problem = urlProblem((value as string).trim(), protocols);
    if (problem) error(name, problem);
  }

  const key = env.BACKEND_CREDENTIAL_ENCRYPTION_KEY;
  if (!failed.has("BACKEND_CREDENTIAL_ENCRYPTION_KEY") && !isBlank(key) && !isValidKey((key as string).trim())) {
    error("BACKEND_CREDENTIAL_ENCRYPTION_KEY", "not a base64-encoded 32-byte key (generate one with: openssl rand -base64 32)");
  }

  const secure = env.BACKEND_SMTP_SECURE;
  if (!isBlank(secure) && !["true", "false"].includes((secure as string).trim())) {
    error("BACKEND_SMTP_SECURE", "must be true or false");
  }

  const level = env.BACKEND_APP_LOG_LEVEL;
  if (!isBlank(level) && !LOG_LEVELS.includes((level as string).trim())) {
    error("BACKEND_APP_LOG_LEVEL", `must be one of ${LOG_LEVELS.join(", ")}`);
  }

  const smtpHost = env.BACKEND_SMTP_HOST;
  if (isBlank(smtpHost) || (smtpHost as string).trim().toLowerCase() === "localhost") {
    warn("BACKEND_SMTP_HOST", "empty or localhost (development default)", "email notifications");
  }
  const from = env.BACKEND_NOTIFICATION_FROM_ADDRESS;
  if (isBlank(from) || (from as string).trim().toLowerCase().endsWith("@localhost")) {
    warn("BACKEND_NOTIFICATION_FROM_ADDRESS", "empty or @localhost (development default)", "email notifications");
  }
  for (const name of [
    "BACKEND_LOGTO_MANAGEMENT_CLIENT_ID",
    "BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET",
    "BACKEND_LOGTO_MANAGEMENT_API_BASE_URL",
  ]) {
    if (isBlank(env[name]) ) warn(name, "empty", "changing the password in the app");
  }
  if (isBlank(env.BACKEND_AGENT_PUBLIC_URL)) {
    warn("BACKEND_AGENT_PUBLIC_URL", "empty", "creating Traefik agents");
  }

  return [...errors, ...warnings];
}
