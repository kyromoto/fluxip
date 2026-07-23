import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HetznerDnsExecutor } from "../../../../src/adapters/actions/hetzner-dns/hetzner-dns-executor.js";

const config = { apiToken: "test-token", zoneId: "zone1", recordName: "home.example.com" };

describe("HetznerDnsExecutor", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fails with a diagnosable error (status + body snippet) when the response isn't JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("<!doctype html><html><body>redirected</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const executor = new HetznerDnsExecutor();
    await expect(executor.execute(config, { ipv4: "203.0.113.1" })).rejects.toThrow(
      /non-JSON response for the record lookup \(status 200, content-type "text\/html"\): <!doctype html>/,
    );
  });

  it("fails with the API's JSON error body (not a raw parse error) on a non-2xx JSON response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({ error: { code: "unauthorized", message: "the token you have provided is invalid" } }, { status: 401 }),
    );

    const executor = new HetznerDnsExecutor();
    await expect(executor.execute(config, { ipv4: "203.0.113.1" })).rejects.toThrow(
      /rejected the record lookup \(401\).*unauthorized.*invalid/,
    );
  });

  it("finds and updates a matching A record on a healthy JSON API", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve(Response.json({ record: { id: "rec1" } }));
      }
      return Promise.resolve(
        Response.json({
          records: [{ id: "rec1", type: "A", name: "home.example.com", value: "old", zone_id: "zone1", ttl: 300 }],
        }),
      );
    });

    const executor = new HetznerDnsExecutor();
    const result = await executor.execute(config, { ipv4: "203.0.113.1" });
    expect(result.summary).toContain("A=203.0.113.1");
  });
});
