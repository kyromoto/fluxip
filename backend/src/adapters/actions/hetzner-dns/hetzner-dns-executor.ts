import { HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE } from "../../../domain/action/events.js";
import type {
  ActionExecutionIpValues,
  ActionExecutionResult,
  ActionExecutor,
} from "../../../ports/action-executor.js";

// FR-035: all Hetzner communication MUST go through the current Hetzner
// Cloud API — the older, separate Hetzner DNS API MUST NOT be used, not even
// as a fallback (spec.md Clarifications, Session 2026-07-24; research.md §18).
//
// The per-rrset `set_records` action below is the manually verified working
// endpoint (spec.md Session 2026-07-24 correction) — not the generic
// zones/rrsets collection endpoint an earlier revision of this adapter used.
const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

export interface HetznerDnsResolvedConfig {
  apiToken: string;
  /** The Hetzner Cloud DNS zone name (e.g. "example.com"). */
  zoneName: string;
  /** The rrset name within the zone, e.g. "@" for the zone apex or "home". */
  recordName: string;
  /** BACKEND_CLOUDEVENTS_SOURCE with its protocol prefix stripped, attributing the update in Hetzner's own record comment. */
  sourceLabel: string;
}

/**
 * Updates an existing A and/or AAAA rrset only (FR-008 — never creates new
 * records): `set_records` acts on a specific, already-existing rrset
 * resource and fails rather than creating one if it doesn't exist. Which
 * families to update is decided upstream by the worker (FR-026/FR-027); this
 * adapter just does whatever ipValues it's given.
 */
export class HetznerDnsExecutor implements ActionExecutor<HetznerDnsResolvedConfig> {
  readonly type = HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE;

  async execute(
    config: HetznerDnsResolvedConfig,
    ipValues: ActionExecutionIpValues,
  ): Promise<ActionExecutionResult> {
    const updates: string[] = [];

    if (ipValues.ipv4) {
      await this.setRecords(config, "A", ipValues.ipv4);
      updates.push(`A=${ipValues.ipv4}`);
    }
    if (ipValues.ipv6) {
      await this.setRecords(config, "AAAA", ipValues.ipv6);
      updates.push(`AAAA=${ipValues.ipv6}`);
    }
    if (updates.length === 0) {
      throw new Error("No IP values supplied to update");
    }

    return { summary: `Updated Hetzner DNS record "${config.recordName}": ${updates.join(", ")}` };
  }

  private async setRecords(config: HetznerDnsResolvedConfig, type: "A" | "AAAA", value: string): Promise<void> {
    // Not percent-encoded: DNS zone/record names (including the literal "@"
    // zone-apex token) only ever contain characters already valid unencoded
    // in a URL path segment, and the manually verified working request uses
    // a literal "@", not "%40".
    const url = `${HETZNER_API_BASE}/zones/${config.zoneName}/rrsets/${config.recordName}/${type}/actions/set_records`;
    const comment = `${config.sourceLabel} | ${new Date().toISOString()}`;

    await this.requestJson(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ value, comment }] }),
      },
      "the rrset update",
    );
  }

  /**
   * Reads the response body exactly once and validates it's actually JSON
   * before parsing — a non-2xx or a misrouted request (e.g. a redirect to an
   * HTML page) must fail with a diagnosable message (status + body snippet),
   * never a raw "Unexpected token '<'" JSON.parse error.
   */
  private async requestJson<T>(url: string, init: RequestInit, context: string): Promise<T> {
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
}
