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
}

const REQUIRED_STRING_VARS = [
  "CLOUDEVENTS_SOURCE",
  "CLOUDEVENTS_TYPE_PREFIX",
  "DATABASE_URL",
  "REDIS_URL",
  "LOGTO_ENDPOINT",
  "CREDENTIAL_ENCRYPTION_KEY",
] as const;

function requireString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalString(env: NodeJS.ProcessEnv, key: string, fallback = ""): string {
  return env[key] ?? fallback;
}

function optionalInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  }
  return parsed;
}

function optionalBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  for (const key of REQUIRED_STRING_VARS) {
    requireString(env, key);
  }

  return {
    cloudEventsSource: requireString(env, "CLOUDEVENTS_SOURCE"),
    cloudEventsTypePrefix: requireString(env, "CLOUDEVENTS_TYPE_PREFIX"),
    defaultIpClientLimit: optionalInt(env, "DEFAULT_IP_CLIENT_LIMIT", 5),
    actionRetryAttempts: optionalInt(env, "ACTION_RETRY_ATTEMPTS", 5),
    actionRetryBaseDelayMs: optionalInt(env, "ACTION_RETRY_BASE_DELAY_MS", 30_000),
    ipClientDebounceMs: optionalInt(env, "IP_CLIENT_DEBOUNCE_MS", 30_000),
    databaseUrl: requireString(env, "DATABASE_URL"),
    redisUrl: requireString(env, "REDIS_URL"),
    logtoEndpoint: requireString(env, "LOGTO_ENDPOINT"),
    logtoAppId: optionalString(env, "LOGTO_APP_ID"),
    logtoAppSecret: optionalString(env, "LOGTO_APP_SECRET"),
    logtoManagementClientId: optionalString(env, "LOGTO_MANAGEMENT_CLIENT_ID"),
    logtoManagementClientSecret: optionalString(env, "LOGTO_MANAGEMENT_CLIENT_SECRET"),
    logtoManagementApiBaseUrl: optionalString(env, "LOGTO_MANAGEMENT_API_BASE_URL"),
    port: optionalInt(env, "PORT", 8080),
    credentialEncryptionKey: requireString(env, "CREDENTIAL_ENCRYPTION_KEY"),
    smtpHost: optionalString(env, "SMTP_HOST", "localhost"),
    smtpPort: optionalInt(env, "SMTP_PORT", 1025),
    smtpUser: optionalString(env, "SMTP_USER"),
    smtpPassword: optionalString(env, "SMTP_PASSWORD"),
    smtpSecure: optionalBool(env, "SMTP_SECURE", false),
    notificationFromAddress: optionalString(env, "NOTIFICATION_FROM_ADDRESS", "fluxip@localhost"),
    appLogLevel: optionalString(env, "APP_LOG_LEVEL", "info"),
    accessLogFilePath: optionalString(env, "ACCESS_LOG_FILE_PATH", "logs/access.log"),
    accessLogMaxSizeBytes: optionalInt(env, "ACCESS_LOG_MAX_SIZE_BYTES", 10_485_760),
    accessLogMaxFiles: optionalInt(env, "ACCESS_LOG_MAX_FILES", 5),
  };
}
