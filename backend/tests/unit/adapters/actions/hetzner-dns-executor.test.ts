import { afterEach, describe, expect, it, vi } from "vitest";
import { HetznerDnsExecutor } from "../../../../src/adapters/actions/hetzner-dns/hetzner-dns-executor.js";

const config = { apiToken: "test-token", zoneName: "kyromoto.de", recordName: "@", sourceLabel: "fluxip.kyro.space" };

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
      /non-JSON response for the rrset update \(status 200, content-type "text\/html"\): <!doctype html>/,
    );
  });

  it("fails with the API's JSON error body (not a raw parse error) on a non-2xx JSON response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      Response.json({ error: { code: "not_found", message: "rrset not found" } }, { status: 404 }),
    );

    const executor = new HetznerDnsExecutor();
    await expect(executor.execute(config, { ipv4: "203.0.113.1" })).rejects.toThrow(
      /rejected the rrset update \(404\).*not_found.*rrset not found/,
    );
  });

  it("calls the set_records action at the verified endpoint with a dynamic comment", async () => {
    let capturedUrl = "";
    let capturedBody: { records: { value: string; comment: string }[] } | undefined;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(Response.json({ action: { id: 1, status: "success" } }));
    });

    const before = Date.now();
    const executor = new HetznerDnsExecutor();
    const result = await executor.execute(config, { ipv4: "203.0.113.1" });
    const after = Date.now();

    expect(capturedUrl).toBe("https://api.hetzner.cloud/v1/zones/kyromoto.de/rrsets/@/A/actions/set_records");
    expect(capturedBody?.records).toEqual([{ value: "203.0.113.1", comment: expect.stringMatching(/^fluxip\.kyro\.space \| /) }]);
    const commentTimestamp = new Date(capturedBody!.records[0].comment.split(" | ")[1]).getTime();
    expect(commentTimestamp).toBeGreaterThanOrEqual(before);
    expect(commentTimestamp).toBeLessThanOrEqual(after);
    expect(result.summary).toContain("A=203.0.113.1");
  });

  it("updates both A and AAAA rrsets with independent set_records calls when both address families are supplied", async () => {
    const calledTypes: string[] = [];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      calledTypes.push(url.includes("/A/actions/") ? "A" : "AAAA");
      return Promise.resolve(Response.json({ action: { id: 1, status: "success" } }));
    });

    const executor = new HetznerDnsExecutor();
    const result = await executor.execute(config, { ipv4: "203.0.113.1", ipv6: "2001:db8::1" });

    expect(calledTypes).toEqual(["A", "AAAA"]);
    expect(result.summary).toContain("A=203.0.113.1");
    expect(result.summary).toContain("AAAA=2001:db8::1");
  });
});
