import type { Config } from "../../config/env.js";

/**
 * Logto's Management API always uses this fixed resource indicator, regardless
 * of deployment/custom domain — it identifies the API itself, not a per-account
 * value, so (unlike BACKEND_LOGTO_ENDPOINT etc.) it is not deployment configuration.
 */
const MANAGEMENT_API_RESOURCE = "https://default.logto.app/api";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

async function getManagementAccessToken(config: Config): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5_000) {
    return cachedToken.accessToken;
  }

  const basicAuth = Buffer.from(
    `${config.logtoManagementClientId}:${config.logtoManagementClientSecret}`,
  ).toString("base64");

  const response = await fetch(`${config.logtoEndpoint}/oidc/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource: MANAGEMENT_API_RESOURCE,
      scope: "all",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to obtain a Logto Management API token: ${response.status}`);
  }
  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.accessToken;
}

/**
 * Proxies an in-app password change to Logto's Management API (research.md §15).
 * `logtoUserId` is the same Logto subject already used as `account_id` elsewhere.
 * The plaintext password passes through only transiently, for this one call —
 * it is never logged, persisted, or included in any event payload.
 */
export async function setUserPassword(config: Config, logtoUserId: string, newPassword: string): Promise<void> {
  const token = await getManagementAccessToken(config);
  const response = await fetch(`${config.logtoManagementApiBaseUrl}/users/${logtoUserId}/password`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password: newPassword }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update password via Logto Management API: ${response.status}`);
  }
}
