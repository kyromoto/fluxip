export interface Config {
  cloudEventsSource: string;
  cloudEventsTypePrefix: string;
  defaultIpClientLimit: number;
  actionRetryAttempts: number;
  actionRetryBaseDelayMs: number;
  ipClientDebounceMs: number;
  databaseUrl: string;
  redisUrl: string;
  logtoEndpoint: string;
  logtoAppId: string;
  logtoAppSecret: string;
  logtoManagementClientId: string;
  logtoManagementClientSecret: string;
  logtoManagementApiBaseUrl: string;
  port: number;
  bindAddress: string;
  /** Base64-encoded 32-byte key used to encrypt Provider Credential secrets at rest (AES-256-GCM). */
  credentialEncryptionKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure: boolean;
  notificationFromAddress: string;
  appLogLevel: string;
  accessLogFilePath: string;
  accessLogMaxSizeBytes: number;
  accessLogMaxFiles: number;
  /** Port of the agent session listener (gRPC over h2c, behind the reverse proxy) — specs/008-traefik-provider-config. */
  agentPort: number;
  /** Public base URL agents use to reach FluxIP (e.g. https://agents.example.com); empty = Traefik providers can't be created. */
  agentPublicUrl: string;
  /** Hard cap on a serialized snapshot (FR-024). */
  agentSnapshotMaxBytes: number;
  /** Window in which several change triggers for one provider collapse into one snapshot (FR-022). */
  agentSnapshotCoalesceMs: number;
  /** Interval of the periodic full-state resend to connected agents (FR-021). */
  agentResyncMs: number;
  /** Heartbeat interval proposed to agents. */
  agentHeartbeatSeconds: number;
  /** The running release, baked into the image as FLUXIP_VERSION; "dev" outside a release build. */
  version: string;
}

export const REQUIRED_STRING_VARS = [
  "BACKEND_CLOUDEVENTS_SOURCE",
  "BACKEND_CLOUDEVENTS_TYPE_PREFIX",
  "BACKEND_DATABASE_URL",
  "BACKEND_REDIS_URL",
  "BACKEND_LOGTO_ENDPOINT",
  "BACKEND_CREDENTIAL_ENCRYPTION_KEY",
] as const;

/** A problem with one environment variable. Never carries the variable's value. */
export interface ConfigProblem {
  name: string;
  kind: "missing" | "not_integer";
}

function describeProblem(problem: ConfigProblem): string {
  return problem.kind === "missing"
    ? `Missing required environment variable: ${problem.name}`
    : `Environment variable ${problem.name} must be an integer`;
}

/** All problems found while reading the configuration, so one run reports everything that is wrong. */
export class ConfigError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(problems.map(describeProblem).join("\n"));
    this.name = "ConfigError";
  }
}

/** Reads variables and records problems instead of throwing at the first one. */
class EnvReader {
  readonly problems: ConfigProblem[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  requireString(key: string): string {
    const value = this.env[key];
    if (!value || value.trim() === "") {
      this.problems.push({ name: key, kind: "missing" });
      return "";
    }
    return value;
  }

  optionalString(key: string, fallback = ""): string {
    return this.env[key] ?? fallback;
  }

  optionalInt(key: string, fallback: number): number {
    const raw = this.env[key];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      this.problems.push({ name: key, kind: "not_integer" });
      return fallback;
    }
    return parsed;
  }

  optionalBool(key: string, fallback: boolean): boolean {
    const raw = this.env[key];
    if (raw === undefined || raw === "") return fallback;
    return raw === "true";
  }
}

function readConfig(env: NodeJS.ProcessEnv): { config: Config; problems: ConfigProblem[] } {
  const r = new EnvReader(env);
  const config: Config = {
    cloudEventsSource: r.requireString("BACKEND_CLOUDEVENTS_SOURCE"),
    cloudEventsTypePrefix: r.requireString("BACKEND_CLOUDEVENTS_TYPE_PREFIX"),
    defaultIpClientLimit: r.optionalInt("BACKEND_DEFAULT_IP_CLIENT_LIMIT", 5),
    actionRetryAttempts: r.optionalInt("BACKEND_ACTION_RETRY_ATTEMPTS", 5),
    actionRetryBaseDelayMs: r.optionalInt("BACKEND_ACTION_RETRY_BASE_DELAY_MS", 30_000),
    ipClientDebounceMs: r.optionalInt("BACKEND_IP_CLIENT_DEBOUNCE_MS", 30_000),
    databaseUrl: r.requireString("BACKEND_DATABASE_URL"),
    redisUrl: r.requireString("BACKEND_REDIS_URL"),
    logtoEndpoint: r.requireString("BACKEND_LOGTO_ENDPOINT"),
    logtoAppId: r.optionalString("BACKEND_LOGTO_APP_ID"),
    logtoAppSecret: r.optionalString("BACKEND_LOGTO_APP_SECRET"),
    logtoManagementClientId: r.optionalString("BACKEND_LOGTO_MANAGEMENT_CLIENT_ID"),
    logtoManagementClientSecret: r.optionalString("BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET"),
    logtoManagementApiBaseUrl: r.optionalString("BACKEND_LOGTO_MANAGEMENT_API_BASE_URL"),
    port: r.optionalInt("BACKEND_PORT", 8080),
    bindAddress: r.optionalString("BACKEND_BIND_ADDRESS", "0.0.0.0").trim() || "0.0.0.0",
    credentialEncryptionKey: r.requireString("BACKEND_CREDENTIAL_ENCRYPTION_KEY"),
    smtpHost: r.optionalString("BACKEND_SMTP_HOST", "localhost"),
    smtpPort: r.optionalInt("BACKEND_SMTP_PORT", 1025),
    smtpUser: r.optionalString("BACKEND_SMTP_USER"),
    smtpPassword: r.optionalString("BACKEND_SMTP_PASSWORD"),
    smtpSecure: r.optionalBool("BACKEND_SMTP_SECURE", false),
    notificationFromAddress: r.optionalString("BACKEND_NOTIFICATION_FROM_ADDRESS", "fluxip@localhost"),
    appLogLevel: r.optionalString("BACKEND_APP_LOG_LEVEL", "info"),
    accessLogFilePath: r.optionalString("BACKEND_ACCESS_LOG_FILE_PATH", "logs/access.log"),
    accessLogMaxSizeBytes: r.optionalInt("BACKEND_ACCESS_LOG_MAX_SIZE_BYTES", 10_485_760),
    accessLogMaxFiles: r.optionalInt("BACKEND_ACCESS_LOG_MAX_FILES", 5),
    agentPort: r.optionalInt("BACKEND_AGENT_PORT", 8081),
    agentPublicUrl: r.optionalString("BACKEND_AGENT_PUBLIC_URL").replace(/\/+$/, ""),
    agentSnapshotMaxBytes: r.optionalInt("BACKEND_AGENT_SNAPSHOT_MAX_BYTES", 1_048_576),
    agentSnapshotCoalesceMs: r.optionalInt("BACKEND_AGENT_SNAPSHOT_COALESCE_MS", 1000),
    agentResyncMs: r.optionalInt("BACKEND_AGENT_RESYNC_MS", 900_000),
    agentHeartbeatSeconds: r.optionalInt("BACKEND_AGENT_HEARTBEAT_SECONDS", 30),
    version: r.optionalString("FLUXIP_VERSION", "dev").trim() || "dev",
  };
  return { config, problems: r.problems };
}

/** Every problem `loadConfig` would stop at, without throwing. Shared with `validate-config`. */
export function collectConfigProblems(env: NodeJS.ProcessEnv = process.env): ConfigProblem[] {
  return readConfig(env).problems;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { config, problems } = readConfig(env);
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
