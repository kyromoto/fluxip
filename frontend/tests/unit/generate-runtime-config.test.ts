import { describe, expect, it, vi } from "vitest";
import { buildConfig, renderConfigJs, renderIndexHtml, warnAboutMissingValues } from "../../scripts/generate-runtime-config.mjs";

describe("buildConfig", () => {
  it("reads all four FRONTEND_* vars into their window.__ENV__ keys", () => {
    const config = buildConfig({
      FRONTEND_LOGTO_ENDPOINT: "https://auth.example.com",
      FRONTEND_LOGTO_APP_ID: "app-id",
      FRONTEND_LOGTO_API_RESOURCE: "https://example.com/api",
      FRONTEND_BACKEND_URL: "https://backend.example.com",
    });
    expect(config).toEqual({
      LOGTO_ENDPOINT: "https://auth.example.com",
      LOGTO_APP_ID: "app-id",
      LOGTO_API_RESOURCE: "https://example.com/api",
      BACKEND_URL: "https://backend.example.com",
    });
  });

  it("never throws and fills missing vars with an empty string", () => {
    expect(() => buildConfig({})).not.toThrow();
    expect(buildConfig({})).toEqual({
      LOGTO_ENDPOINT: "",
      LOGTO_APP_ID: "",
      LOGTO_API_RESOURCE: "",
      BACKEND_URL: "",
    });
  });

  it("ignores unrelated env vars", () => {
    const config = buildConfig({ PATH: "/usr/bin", HOME: "/root" });
    expect(config.LOGTO_ENDPOINT).toBe("");
  });
});

describe("renderConfigJs", () => {
  it("safely JSON-encodes hostile values (FR-007)", () => {
    const js = renderConfigJs({
      LOGTO_ENDPOINT: "</script><script>alert(1)</script>",
      LOGTO_APP_ID: "x",
      LOGTO_API_RESOURCE: "x",
      BACKEND_URL: "x",
    });
    expect(js).toContain(JSON.stringify("</script><script>alert(1)</script>"));
    expect(js.startsWith("window.__ENV__ = ")).toBe(true);
  });
});

describe("renderIndexHtml", () => {
  it("replaces the __CONFIG_VERSION__ placeholder with the given token", () => {
    const html = '<script src="/config.js?v=__CONFIG_VERSION__"></script>';
    expect(renderIndexHtml(html, "12345")).toBe('<script src="/config.js?v=12345"></script>');
  });
});

describe("warnAboutMissingValues", () => {
  it("logs one line per empty value, naming the FRONTEND_* env var", () => {
    const log = vi.fn();
    warnAboutMissingValues(
      { LOGTO_ENDPOINT: "set", LOGTO_APP_ID: "", LOGTO_API_RESOURCE: "", BACKEND_URL: "set" },
      log,
    );
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join("\n")).toContain("FRONTEND_LOGTO_APP_ID");
    expect(log.mock.calls.flat().join("\n")).toContain("FRONTEND_LOGTO_API_RESOURCE");
  });

  it("logs nothing when every value is present", () => {
    const log = vi.fn();
    warnAboutMissingValues(
      { LOGTO_ENDPOINT: "a", LOGTO_APP_ID: "b", LOGTO_API_RESOURCE: "c", BACKEND_URL: "d" },
      log,
    );
    expect(log).not.toHaveBeenCalled();
  });
});
