import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const domainDir = resolve(here, "../../../../src/domain/traefik-provider");

/**
 * SC-008 / FR-032: the session logic must not know who opened the connection. A later server-initiated
 * adapter may only implement AgentChannel; if the domain started importing adapters, that would break.
 */
describe("session logic is independent of the connection direction", () => {
  const files = readdirSync(domainDir).filter((f) => f.endsWith(".ts"));

  it("no file in domain/traefik-provider imports from adapters/ or a gRPC library", () => {
    for (const file of files) {
      const source = readFileSync(join(domainDir, file), "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/adapters\//);
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^@grpc\//);
      }
    }
  });

  it("the handler only depends on the AgentChannel port for talking to the peer", () => {
    const source = readFileSync(join(domainDir, "agent-session-handler.ts"), "utf8");
    expect(source).toContain('from "./agent-channel.js"');
    expect(source).not.toMatch(/\bcall\.|metadata|ServerDuplexStream/);
  });
});
