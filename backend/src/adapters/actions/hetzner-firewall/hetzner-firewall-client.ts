import type { HetznerFirewallRule } from "../../../domain/action/firewall-rule-selector.js";

// FR-013: all Hetzner communication MUST go through the current Hetzner Cloud API — never the
// legacy, separate Hetzner DNS API (which never covered firewalls anyway). See
// contracts/hetzner-firewall-api.md.
const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

interface GetFirewallResponse {
  firewall: { rules: HetznerFirewallRule[] };
}

/** Reads the current rule set of a Hetzner Cloud Firewall (FR-008/FR-018). */
export async function getFirewall(apiToken: string, firewallId: number): Promise<HetznerFirewallRule[]> {
  const response = await requestJson<GetFirewallResponse>(
    `${HETZNER_API_BASE}/firewalls/${firewallId}`,
    { method: "GET", headers: { Authorization: `Bearer ${apiToken}` } },
    "reading the firewall",
  );
  return response.firewall.rules;
}

/**
 * Replaces a firewall's ENTIRE rule set in one call — there is no partial-patch endpoint
 * (contracts/hetzner-firewall-api.md). Every caller MUST hold the advisory lock
 * (hetzner-firewall-lock.ts) around the read-modify-write cycle this implies.
 */
export async function setFirewallRules(
  apiToken: string,
  firewallId: number,
  rules: HetznerFirewallRule[],
): Promise<void> {
  await requestJson(
    `${HETZNER_API_BASE}/firewalls/${firewallId}/actions/set_firewall_rules`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ rules }),
    },
    "the set_firewall_rules update",
  );
}

/**
 * Same diagnosable-error convention as hetzner-dns-executor.ts's requestJson: reads the response
 * body exactly once and validates it's actually JSON before parsing, so a non-2xx or a misrouted
 * request fails with a diagnosable message (status + body snippet), never a raw parse error.
 */
async function requestJson<T>(url: string, init: RequestInit, context: string): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") ?? "";
  const rawBody = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Hetzner Cloud API returned a non-JSON response for ${context} ` +
        `(status ${response.status}, content-type "${contentType || "none"}"): ${rawBody.slice(0, 200)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Hetzner Cloud API rejected ${context} (${response.status}): ${rawBody.slice(0, 500)}`);
  }
  return JSON.parse(rawBody) as T;
}
