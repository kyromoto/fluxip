import { describe, expect, it, vi } from "vitest";
import { checkConfig, KNOWN_VARS, type ConfigFinding } from "../../../src/config/check.js";
import { loadConfig } from "../../../src/config/env.js";

const KEY = Buffer.alloc(32, 7).toString("base64");

/** A configuration without findings. */
const good: NodeJS.ProcessEnv = {
  BACKEND_CLOUDEVENTS_SOURCE: "https://fluxip.example.com",
  BACKEND_CLOUDEVENTS_TYPE_PREFIX: "space.example.fluxip",
  BACKEND_DATABASE_URL: "postgresql://fluxip:pw@db.example.com:5432/fluxip",
  BACKEND_REDIS_URL: "redis://redis.example.com:6379",
  BACKEND_LOGTO_ENDPOINT: "https://auth.example.com",
  BACKEND_CREDENTIAL_ENCRYPTION_KEY: KEY,
  BACKEND_SMTP_HOST: "smtp.example.com",
  BACKEND_NOTIFICATION_FROM_ADDRESS: "fluxip@example.com",
  BACKEND_LOGTO_MANAGEMENT_CLIENT_ID: "m2m",
  BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET: "m2m-secret",
  BACKEND_LOGTO_MANAGEMENT_API_BASE_URL: "https://auth-admin.example.com/api",
  BACKEND_AGENT_PUBLIC_URL: "https://agents.example.com",
};

const find = (findings: ConfigFinding[], name: string): ConfigFinding | undefined => findings.find((f) => f.name === name);
const withEnv = (overrides: NodeJS.ProcessEnv): ConfigFinding[] => checkConfig({ ...good, ...overrides });

describe("checkConfig — errors", () => {
  it("has no findings for a complete, valid configuration", () => {
    expect(checkConfig(good)).toEqual([]);
  });

  it("names all six required variables when the environment is empty (and tells missing from invalid)", () => {
    const findings = checkConfig({});
    const missing = findings.filter((f) => f.level === "error").map((f) => f.name).sort();
    expect(missing).toEqual(
      ["BACKEND_CLOUDEVENTS_SOURCE", "BACKEND_CLOUDEVENTS_TYPE_PREFIX", "BACKEND_CREDENTIAL_ENCRYPTION_KEY", "BACKEND_DATABASE_URL", "BACKEND_LOGTO_ENDPOINT", "BACKEND_REDIS_URL"].sort(),
    );
    expect(find(findings, "BACKEND_DATABASE_URL")?.reason).toBe("missing");
  });

  it("reports all problems of one run together", () => {
    const findings = withEnv({ BACKEND_PORT: "abc", BACKEND_SMTP_SECURE: "yes", BACKEND_REDIS_URL: "not a url", BACKEND_CREDENTIAL_ENCRYPTION_KEY: "short" });
    expect(findings.filter((f) => f.level === "error").map((f) => f.name).sort()).toEqual(
      ["BACKEND_CREDENTIAL_ENCRYPTION_KEY", "BACKEND_PORT", "BACKEND_REDIS_URL", "BACKEND_SMTP_SECURE"].sort(),
    );
  });

  it.each([
    ["abc", "not an integer"],
    ["80.5", "not an integer"],
    ["0", "must be between 1 and 65535"],
    ["70000", "must be between 1 and 65535"],
  ])("rejects BACKEND_PORT=%s", (value, reason) => {
    expect(find(withEnv({ BACKEND_PORT: value }), "BACKEND_PORT")).toMatchObject({ level: "error", reason });
  });

  it("rejects a negative duration", () => {
    expect(find(withEnv({ BACKEND_AGENT_RESYNC_MS: "-1" }), "BACKEND_AGENT_RESYNC_MS")).toMatchObject({ level: "error", reason: "must be at least 0" });
  });

  it.each([
    ["BACKEND_DATABASE_URL", "mysql://x@y/z", "unexpected scheme (expected postgres or postgresql)"],
    ["BACKEND_DATABASE_URL", "garbage", "not a valid URL"],
    ["BACKEND_REDIS_URL", "http://redis", "unexpected scheme (expected redis or rediss)"],
    ["BACKEND_LOGTO_ENDPOINT", "ftp://auth", "unexpected scheme (expected http or https)"],
  ])("rejects %s=%s", (name, value, reason) => {
    expect(find(withEnv({ [name]: value }), name)).toMatchObject({ level: "error", reason });
  });

  it.each([
    ["not base64 !!", false],
    [Buffer.alloc(16, 1).toString("base64"), false],
    [Buffer.alloc(33, 1).toString("base64"), false],
    [KEY, true],
  ])("encryption key %j valid=%s", (value, valid) => {
    expect(find(withEnv({ BACKEND_CREDENTIAL_ENCRYPTION_KEY: value }), "BACKEND_CREDENTIAL_ENCRYPTION_KEY") === undefined).toBe(valid);
  });

  it("rejects a log level and a boolean that the app would silently misread", () => {
    expect(find(withEnv({ BACKEND_APP_LOG_LEVEL: "loud" }), "BACKEND_APP_LOG_LEVEL")?.level).toBe("error");
    expect(find(withEnv({ BACKEND_SMTP_SECURE: "TRUE" }), "BACKEND_SMTP_SECURE")?.level).toBe("error");
    expect(find(withEnv({ BACKEND_SMTP_SECURE: "true" }), "BACKEND_SMTP_SECURE")).toBeUndefined();
  });

  it("does not look at the unused BACKEND_LOGTO_APP_ID / _SECRET", () => {
    expect(find(withEnv({}), "BACKEND_LOGTO_APP_ID")).toBeUndefined();
    expect(find(withEnv({}), "BACKEND_LOGTO_APP_SECRET")).toBeUndefined();
  });
});

describe("checkConfig — warnings", () => {
  it("warns about development defaults for email, and names the feature", () => {
    const findings = withEnv({ BACKEND_SMTP_HOST: undefined, BACKEND_NOTIFICATION_FROM_ADDRESS: "fluxip@localhost" });
    expect(find(findings, "BACKEND_SMTP_HOST")).toMatchObject({ level: "warning", feature: "email notifications" });
    expect(find(findings, "BACKEND_NOTIFICATION_FROM_ADDRESS")).toMatchObject({ level: "warning", feature: "email notifications" });
    expect(find(withEnv({ BACKEND_SMTP_HOST: "localhost" }), "BACKEND_SMTP_HOST")?.level).toBe("warning");
  });

  it("warns for each missing management value, also when only some are set", () => {
    const findings = withEnv({ BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET: "" });
    expect(findings.filter((f) => f.level === "warning").map((f) => f.name)).toEqual(["BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET"]);
    expect(find(findings, "BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET")?.feature).toBe("changing the password in the app");
  });

  it("warns when agents cannot be created", () => {
    expect(find(withEnv({ BACKEND_AGENT_PUBLIC_URL: "" }), "BACKEND_AGENT_PUBLIC_URL")).toMatchObject({ level: "warning", feature: "creating Traefik agents" });
  });

  it("lists errors before warnings and keeps warnings from changing the error count", () => {
    const findings = withEnv({ BACKEND_PORT: "x", BACKEND_AGENT_PUBLIC_URL: "" });
    expect(findings.map((f) => f.level)).toEqual(["error", "warning"]);
  });
});

describe("checkConfig — secrets never appear in the findings (FR-008, SC-004)", () => {
  it("leaves out every value, including secrets in invalid settings", () => {
    const secrets = ["sentinel-key-9f3a", "sentinel-smtp-pass-1c7e", "sentinel-db-pass-5b2d", "sentinel-m2m-8d4f"];
    const findings = checkConfig({
      ...good,
      BACKEND_CREDENTIAL_ENCRYPTION_KEY: secrets[0],
      BACKEND_SMTP_PASSWORD: secrets[1],
      BACKEND_DATABASE_URL: `mysql://user:${secrets[2]}@host/db`,
      BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET: secrets[3],
      BACKEND_PORT: "sentinel-port-6a1b",
    });
    const text = JSON.stringify(findings);
    for (const secret of [...secrets, "sentinel-port-6a1b"]) expect(text).not.toContain(secret);
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe("KNOWN_VARS stays in step with loadConfig", () => {
  it("covers every variable loadConfig reads, and nothing else", () => {
    const read = new Set<string>();
    const spy = vi.fn();
    const env = new Proxy({} as NodeJS.ProcessEnv, {
      get(_target, prop) {
        if (typeof prop === "string") {
          read.add(prop);
          spy(prop);
        }
        return undefined;
      },
    });
    try {
      loadConfig(env);
    } catch {
      // The required variables are missing; only the reads matter here.
    }
    expect([...read].sort()).toEqual(Object.keys(KNOWN_VARS).sort());
  });
});
