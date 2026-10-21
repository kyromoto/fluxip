import { loadConfig, type Config } from "../../src/config/env.js";

/** A fully populated Config for unit tests that don't touch the environment. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      BACKEND_CLOUDEVENTS_SOURCE: "https://fluxip.test",
      BACKEND_CLOUDEVENTS_TYPE_PREFIX: "test.fluxip",
      BACKEND_DATABASE_URL: "postgresql://unused",
      BACKEND_REDIS_URL: "redis://unused",
      BACKEND_LOGTO_ENDPOINT: "https://logto.test",
      BACKEND_CREDENTIAL_ENCRYPTION_KEY: "unused",
      BACKEND_AGENT_PUBLIC_URL: "https://agents.test",
    }),
    ...overrides,
  };
}
