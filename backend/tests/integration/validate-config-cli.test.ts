import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, runCli, type CliIo } from "../../src/cli.js";

const KEY = Buffer.alloc(32, 9).toString("base64");

function capture(env: NodeJS.ProcessEnv): { io: CliIo; lines: () => string[] } {
  const out: string[] = [];
  return { io: { stdout: (l) => out.push(l), stderr: (l) => out.push(l), env }, lines: () => out };
}

describe("validate-config (specs/010)", () => {
  let logto: http.Server;
  let logtoUrl: string;
  let mode: "ok" | "bad-gateway" | "hang" = "ok";

  const goodEnv = (): NodeJS.ProcessEnv => ({
    BACKEND_CLOUDEVENTS_SOURCE: "https://fluxip.example.com",
    BACKEND_CLOUDEVENTS_TYPE_PREFIX: "space.example.fluxip",
    BACKEND_DATABASE_URL: process.env.BACKEND_DATABASE_URL,
    BACKEND_REDIS_URL: process.env.BACKEND_REDIS_URL,
    BACKEND_LOGTO_ENDPOINT: logtoUrl,
    BACKEND_CREDENTIAL_ENCRYPTION_KEY: KEY,
    BACKEND_SMTP_HOST: "smtp.example.com",
    BACKEND_NOTIFICATION_FROM_ADDRESS: "fluxip@example.com",
    BACKEND_LOGTO_MANAGEMENT_CLIENT_ID: "m2m",
    BACKEND_LOGTO_MANAGEMENT_CLIENT_SECRET: "m2m-secret",
    BACKEND_LOGTO_MANAGEMENT_API_BASE_URL: "https://auth-admin.example.com/api",
    BACKEND_AGENT_PUBLIC_URL: "https://agents.example.com",
  });

  beforeAll(async () => {
    logto = http.createServer((req, res) => {
      if (mode === "hang") return; // never answers
      if (req.url !== "/oidc/jwks") {
        res.statusCode = 404;
        return res.end();
      }
      res.statusCode = mode === "ok" ? 200 : 502;
      res.setHeader("content-type", "application/json");
      res.end(mode === "ok" ? JSON.stringify({ keys: [] }) : "{}");
    });
    await new Promise<void>((resolve) => logto.listen(0, "127.0.0.1", resolve));
    logtoUrl = `http://127.0.0.1:${(logto.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    logto.closeAllConnections();
    await new Promise((resolve) => logto.close(resolve));
  });

  it("says ok and exits 0 for a complete configuration", async () => {
    const { io, lines } = capture(goodEnv());
    expect(await runCli(["validate-config"], io)).toBe(EXIT_OK);
    expect(lines()).toEqual(["configuration ok"]);
  });

  it("lists warnings, still exits 0, and names the affected feature", async () => {
    const { io, lines } = capture({ ...goodEnv(), BACKEND_SMTP_HOST: undefined, BACKEND_AGENT_PUBLIC_URL: "" });
    expect(await runCli(["validate-config"], io)).toBe(EXIT_OK);
    expect(lines()).toEqual([
      "WARN  BACKEND_SMTP_HOST: empty or localhost (development default) (email notifications will not work)",
      "WARN  BACKEND_AGENT_PUBLIC_URL: empty (creating Traefik agents will not work)",
      "configuration ok (2 warning(s))",
    ]);
  });

  it("lists every error in one run and exits 1 (SC-003)", async () => {
    const { io, lines } = capture({ BACKEND_PORT: "abc", BACKEND_CREDENTIAL_ENCRYPTION_KEY: "short" });
    expect(await runCli(["validate-config"], io)).toBe(EXIT_ERROR);
    const text = lines().join("\n");
    for (const name of ["BACKEND_CLOUDEVENTS_SOURCE", "BACKEND_DATABASE_URL", "BACKEND_REDIS_URL", "BACKEND_LOGTO_ENDPOINT", "BACKEND_PORT", "BACKEND_CREDENTIAL_ENCRYPTION_KEY"]) {
      expect(text).toContain(`ERROR ${name}:`);
    }
    expect(lines().at(-1)).toMatch(/^\d+ error\(s\), \d+ warning\(s\)$/);
  });

  it("never prints a secret, not even for an invalid setting (SC-004)", async () => {
    const { io, lines } = capture({
      ...goodEnv(),
      BACKEND_CREDENTIAL_ENCRYPTION_KEY: "sentinel-key-4e2a",
      BACKEND_DATABASE_URL: "mysql://user:sentinel-db-77ab@host/db",
      BACKEND_SMTP_PASSWORD: "sentinel-smtp-31cd",
    });
    expect(await runCli(["validate-config", "--online"], io)).toBe(EXIT_ERROR);
    const text = lines().join("\n");
    expect(text).not.toMatch(/sentinel-/);
  });

  describe("--online", () => {
    it("confirms Postgres, Redis and Logto when they answer", async () => {
      mode = "ok";
      const { io, lines } = capture(goodEnv());
      expect(await runCli(["validate-config", "--online"], io)).toBe(EXIT_OK);
      expect(lines()).toEqual(["configuration ok", "ok    postgres", "ok    redis", "ok    logto"]);
    });

    it("reports an unreachable service by error code, without credentials, and checks the others anyway", async () => {
      mode = "ok";
      const { io, lines } = capture({
        ...goodEnv(),
        BACKEND_DATABASE_URL: "postgresql://someone:s3cretpw@127.0.0.1:1/nothing",
        BACKEND_REDIS_URL: "redis://:redispw@127.0.0.1:1",
      });
      expect(await runCli(["validate-config", "--online"], io)).toBe(EXIT_ERROR);
      expect(lines()).toEqual(["configuration ok", "FAIL  postgres: ECONNREFUSED", "FAIL  redis: ECONNREFUSED", "ok    logto"]);
      expect(lines().join("\n")).not.toMatch(/s3cretpw|redispw/);
    });

    it("reports the HTTP status of a failing Logto", async () => {
      mode = "bad-gateway";
      const { io, lines } = capture(goodEnv());
      expect(await runCli(["validate-config", "--online"], io)).toBe(EXIT_ERROR);
      expect(lines()).toContain("FAIL  logto: HTTP 502");
      expect(lines()).toContain("ok    postgres");
    });

    it("gives up on a hanging service after the time limit, without holding up the others (FR-010)", async () => {
      mode = "hang";
      const { io, lines } = capture(goodEnv());
      const started = Date.now();
      expect(await runCli(["validate-config", "--online"], io)).toBe(EXIT_ERROR);
      const elapsed = Date.now() - started;
      expect(lines()).toEqual(["configuration ok", "ok    postgres", "ok    redis", "FAIL  logto: timeout"]);
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(8_000);
      mode = "ok";
    }, 15_000);

    it("skips a service whose address is invalid instead of failing it twice", async () => {
      mode = "ok";
      const { io, lines } = capture({ ...goodEnv(), BACKEND_REDIS_URL: "not a url" });
      expect(await runCli(["validate-config", "--online"], io)).toBe(EXIT_ERROR);
      expect(lines()).toEqual(["ERROR BACKEND_REDIS_URL: not a valid URL", "1 error(s), 0 warning(s)", "ok    postgres", "skip  redis: configuration invalid", "ok    logto"]);
    });
  });

  it("exits 2 for an unknown option", async () => {
    const { io } = capture(goodEnv());
    expect(await runCli(["validate-config", "--offline"], io)).toBe(EXIT_USAGE);
  });
});
