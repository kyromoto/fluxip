import { UPDATE_DNS_RECORD_ACTION_TYPE } from "../../../domain/action/events.js";
import type {
  ActionExecutionIpValues,
  ActionExecutionResult,
  ActionExecutor,
} from "../../../ports/action-executor.js";

const HETZNER_API_BASE = "https://dns.hetzner.com/api/v1";

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

    const response = await fetch(`${HETZNER_API_BASE}/records/${record.id}`, {
      method: "PUT",
      headers: { "Auth-API-Token": config.apiToken, "Content-Type": "application/json" },
      body: JSON.stringify({ value, ttl: record.ttl, type, name: record.name, zone_id: config.zoneId }),
    });

    if (!response.ok) {
      throw new Error(`Hetzner DNS API rejected the update (${response.status}): ${await response.text()}`);
    }
  }

  private async findRecord(
    config: HetznerDnsResolvedConfig,
    type: "A" | "AAAA",
  ): Promise<HetznerRecord | null> {
    const response = await fetch(`${HETZNER_API_BASE}/records?zone_id=${config.zoneId}`, {
      headers: { "Auth-API-Token": config.apiToken },
    });
    if (!response.ok) {
      throw new Error(
        `Hetzner DNS API rejected the record lookup (${response.status}): ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { records: HetznerRecord[] };
    return body.records.find((r) => r.type === type && r.name === config.recordName) ?? null;
  }
}
