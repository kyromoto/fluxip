import { afterEach, describe, expect, it, vi } from "vitest";
import { getBackendUrl, getLogtoApiResource, getLogtoAppId, getLogtoEndpoint } from "~/config";

afterEach(() => {
  delete window.__ENV__;
  vi.unstubAllEnvs();
});

describe("config.ts window.__ENV__ / import.meta.env fallback", () => {
  it("prefers a non-empty window.__ENV__ value over the build-time value", () => {
    window.__ENV__ = { LOGTO_ENDPOINT: "https://runtime.example.com" };
    vi.stubEnv("VITE_LOGTO_ENDPOINT", "https://build-time.example.com");
    expect(getLogtoEndpoint()).toBe("https://runtime.example.com");
  });

  it("falls back to import.meta.env.VITE_* when window.__ENV__ is absent", () => {
    delete window.__ENV__;
    vi.stubEnv("VITE_LOGTO_APP_ID", "build-time-app-id");
    expect(getLogtoAppId()).toBe("build-time-app-id");
  });

  it("falls back to import.meta.env.VITE_* when the window.__ENV__ key is empty", () => {
    window.__ENV__ = { LOGTO_API_RESOURCE: "" };
    vi.stubEnv("VITE_LOGTO_API_RESOURCE", "https://build-time.example.com/api");
    expect(getLogtoApiResource()).toBe("https://build-time.example.com/api");
  });

  it("returns an empty string, never undefined/null, when both sources are unset", () => {
    delete window.__ENV__;
    vi.stubEnv("VITE_BACKEND_URL", "");
    expect(getBackendUrl()).toBe("");
  });
});
