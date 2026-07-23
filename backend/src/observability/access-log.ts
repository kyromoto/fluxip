import { getConnInfo } from "@hono/node-server/conninfo";
import { honoLogger, type HonoContext } from "@logtape/hono";
import type { MiddlewareHandler } from "hono";

/**
 * Connection remote address (the same helper trigger.ts already uses),
 * falling back to X-Forwarded-For for reverse-proxied deployments or when no
 * real socket is available (research.md §7) — e.g. an in-process test request.
 */
export function resolveSourceIp(c: HonoContext): string | undefined {
  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // No real socket behind this request (e.g. an in-process test call).
  }
  const forwardedFor = c.req.header("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim();
}

/** The Access Log's request-logging + correlation-context middleware (FR-006/FR-007, contracts/logging-topology.md). */
export function createAccessLogMiddleware(): MiddlewareHandler {
  return honoLogger({
    category: ["fluxip", "access"],
    format: "structured-combined",
    context: { enrich: (c) => ({ sourceIp: resolveSourceIp(c) }) },
  });
}
