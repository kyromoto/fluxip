import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../../src/config/env.js";
import { testConfig } from "../../helpers/test-config.js";

const valid = {
  BACKEND_CLOUDEVENTS_SOURCE: "https://fluxip.test",
  BACKEND_CLOUDEVENTS_TYPE_PREFIX: "test.fluxip",
  BACKEND_DATABASE_URL: "postgresql://unused",
  BACKEND_REDIS_URL: "redis://unused",
  BACKEND_LOGTO_ENDPOINT: "https://logto.test",
  BACKEND_CREDENTIAL_ENCRYPTION_KEY: "unused",
};

describe("loadConfig", () => {
  it("returns the configuration and the documented defaults for a valid environment", () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({ port: 8080, agentPort: 8081, smtpHost: "localhost", appLogLevel: "info", version: "dev" });
    expect(testConfig().credentialEncryptionKey).toBe("unused");
  });

  it("reports every missing required variable in one ConfigError, not just the first", () => {
    const error = (() => {
      try {
        loadConfig({});
      } catch (e) {
        return e as ConfigError;
      }
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect(error!.problems.map((p) => p.name).sort()).toEqual(
      [
        "BACKEND_CLOUDEVENTS_SOURCE",
        "BACKEND_CLOUDEVENTS_TYPE_PREFIX",
        "BACKEND_CREDENTIAL_ENCRYPTION_KEY",
        "BACKEND_DATABASE_URL",
        "BACKEND_LOGTO_ENDPOINT",
        "BACKEND_REDIS_URL",
      ].sort(),
    );
    expect(error!.message.split("\n")[0]).toMatch(/^Missing required environment variable: BACKEND_/);
  });

  it("counts a whitespace-only value as missing", () => {
    expect(() => loadConfig({ ...valid, BACKEND_REDIS_URL: "   " })).toThrow("Missing required environment variable: BACKEND_REDIS_URL");
  });

  it("names a non-integer variable without echoing its value", () => {
    const run = (): unknown => loadConfig({ ...valid, BACKEND_PORT: "eighty-secret" });
    expect(run).toThrow("Environment variable BACKEND_PORT must be an integer");
    try {
      run();
    } catch (e) {
      expect((e as Error).message).not.toContain("eighty-secret");
    }
  });

  it("collects missing and invalid variables together", () => {
    try {
      loadConfig({ BACKEND_PORT: "x" });
      expect.unreachable();
    } catch (e) {
      const names = (e as ConfigError).problems.map((p) => p.name);
      expect(names).toContain("BACKEND_PORT");
      expect(names).toContain("BACKEND_DATABASE_URL");
    }
  });
});
