import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Config } from "../../config/env.js";

export interface AuthContext {
  /** The verified token's subject — used as tenant_id everywhere (research.md §7). */
  tenantId: string;
  roles: string[];
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(config: Config): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(config.logtoEndpoint);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${config.logtoEndpoint}/oidc/jwks`));
    jwksCache.set(config.logtoEndpoint, jwks);
  }
  return jwks;
}

function extractRoles(payload: JWTPayload): string[] {
  const roles = (payload as { roles?: unknown }).roles;
  return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
}

/**
 * Verifies a Logto-issued OIDC access token via JWKS. On success, stores an
 * AuthContext (tenantId = token subject, roles) on the request context under "auth".
 * FluxIP never sees or stores a password — Logto owns the entire login flow (research.md §7).
 */
export function oidcAuthMiddleware(config: Config) {
  const jwks = getJwks(config);

  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice("Bearer ".length);

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${config.logtoEndpoint}/oidc`,
      });

      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        return c.json({ error: "unauthorized" }, 401);
      }

      const auth: AuthContext = { tenantId: payload.sub, roles: extractRoles(payload) };
      c.set("auth", auth);
      await next();
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
  };
}

export function getAuth(c: Context): AuthContext {
  const auth = c.get("auth") as AuthContext | undefined;
  if (!auth) {
    throw new Error("oidcAuthMiddleware did not run before getAuth() was called");
  }
  return auth;
}
