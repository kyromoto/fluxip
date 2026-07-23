import { UPDATE_DNS_RECORD_ACTION_TYPE } from "../../../domain/action/events.js";
import type {
  ActionExecutionIpValues,
  ActionExecutionResult,
  ActionExecutor,
} from "../../../ports/action-executor.js";

// Hetzner consolidated the DNS API under api.hetzner.com/v1/dns (Bearer auth) —
// the previous dns.hetzner.com/api/v1 host now 301-redirects every request
// (regardless of path or token validity) to the Hetzner Console web app.
const HETZNER_API_BASE = "https://api.hetzner.com/v1/dns";

interface HetznerRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  zone_id: string;
  ttl?: number;
}

export interface HetznerDnsResolvedConfig {
  apiToken: string;
  /** The Hetzner DNS zone ID (found in the Hetzner Console), not the zone name. */
  zoneId: string;
  recordName: string;
}

/**
 * Updates an existing A and/or AAAA record only (FR-008 — never creates new
 * records). Which families to update is decided upstream by the worker
 * (FR-026/FR-027); this adapter just does whatever ipValues it's given.
 */
export class HetznerDnsExecutor implements ActionExecutor<HetznerDnsResolvedConfig> {
  readonly type = UPDATE_DNS_RECORD_ACTION_TYPE;

  async execute(
    config: HetznerDnsResolvedConfig,
    ipValues: ActionExecutionIpValues,
  ): Promise<ActionExecutionResult> {
    const updates: string[] = [];

    if (ipValues.ipv4) {
      await this.updateRecord(config, "A", ipValues.ipv4);
      updates.push(`A=${ipValues.ipv4}`);
    }
    if (ipValues.ipv6) {
      await this.updateRecord(config, "AAAA", ipValues.ipv6);
      updates.push(`AAAA=${ipValues.ipv6}`);
    }
    if (updates.length === 0) {
      throw new Error("No IP values supplied to update");
    }

    return { summary: `Updated Hetzner DNS record "${config.recordName}": ${updates.join(", ")}` };
  }

  private async updateRecord(
    config: HetznerDnsResolvedConfig,
    type: "A" | "AAAA",
    value: string,
  ): Promise<void> {
    const record = await this.findRecord(config, type);
    if (!record) {
      throw new Error(
        `No existing ${type} record named "${config.recordName}" found in zone ${config.zoneId}`,
      );
    }

    await this.requestJson(
      `${HETZNER_API_BASE}/records/${record.id}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ value, ttl: record.ttl, type, name: record.name, zone_id: config.zoneId }),
      },
      "the record update",
    );
  }

  private async findRecord(
    config: HetznerDnsResolvedConfig,
    type: "A" | "AAAA",
  ): Promise<HetznerRecord | null> {
    const body = await this.requestJson<{ records: HetznerRecord[] }>(
      `${HETZNER_API_BASE}/records?zone_id=${config.zoneId}`,
      { headers: { Authorization: `Bearer ${config.apiToken}` } },
      "the record lookup",
    );
    return body.records.find((r) => r.type === type && r.name === config.recordName) ?? null;
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
        `Hetzner DNS API returned a non-JSON response for ${context} ` +
          `(status ${response.status}, content-type "${contentType || "none"}"): ${rawBody.slice(0, 200)}`,
      );
    }
    if (!response.ok) {
      throw new Error(`Hetzner DNS API rejected ${context} (${response.status}): ${rawBody.slice(0, 500)}`);
    }
    return JSON.parse(rawBody) as T;
  }
}
