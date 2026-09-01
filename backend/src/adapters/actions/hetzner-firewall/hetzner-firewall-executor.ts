import type { Redis } from "ioredis";
import { HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE, type AddressFamily } from "../../../domain/action/events.js";
import { matchFirewallRule } from "../../../domain/action/firewall-rule-selector.js";
import type {
  ActionExecutionIpValues,
  ActionExecutionResult,
  ActionExecutor,
} from "../../../ports/action-executor.js";
import { getFirewall, setFirewallRules } from "./hetzner-firewall-client.js";
import { acquireFirewallLock } from "./hetzner-firewall-lock.js";

export interface HetznerFirewallResolvedConfig {
  apiToken: string;
  accountId: string;
  firewallId: number;
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "icmp" | "esp" | "ah" | "gre";
  port?: string;
  description: string;
  /** This Action's currently-owned entries (ActionState.firewallOwnedEntries) — what to remove before adding the new value. */
  previousEntries: { ipv4?: string; ipv6?: string };
}

/** Single addresses from ipValues must be suffixed to CIDR form (FR-014) — Hetzner's source_ips/destination_ips expect CIDR notation. */
export function toCidr(address: string, family: AddressFamily): string {
  return family === "ipv4" ? `${address}/32` : `${address}/128`;
}

export interface ApplyFirewallRuleUpdateParams {
  redis: Redis;
  config: HetznerFirewallResolvedConfig;
  remove?: Partial<Record<AddressFamily, string>>;
  add?: Partial<Record<AddressFamily, string>>;
}

/**
 * The single locked read-modify-write path every mutation of a firewall rule's address list goes
 * through — normal execution (adds+removes, called from HetznerFirewallExecutor.execute below) and
 * the best-effort cleanup on Detach/family-drop (removes only, called directly from
 * adapters/http/routes/actions.ts). research.md §2/§3 of 007-hetzner-firewall-action.
 *
 * Only ever touches the entries named in `remove`/`add` within the matched rule's address list —
 * every other entry (static IPs, other Actions' entries) is left exactly as read (FR-006).
 */
export async function applyFirewallRuleUpdate(params: ApplyFirewallRuleUpdateParams): Promise<void> {
  const { redis, config, remove = {}, add = {} } = params;
  const lock = await acquireFirewallLock(redis, config.accountId, config.firewallId);
  try {
    const rules = await getFirewall(config.apiToken, config.firewallId);
    const matched = matchFirewallRule(rules, {
      direction: config.direction,
      protocol: config.protocol,
      port: config.port,
      description: config.description,
    });
    if ("error" in matched) {
      throw new Error(
        matched.error === "no_match"
          ? `No firewall rule on firewall ${config.firewallId} matches the configured selector (direction/protocol/port/description)`
          : `${matched.matchCount} firewall rules on firewall ${config.firewallId} match the configured selector; expected exactly one`,
      );
    }

    const listKey = matched.rule.direction === "in" ? "source_ips" : "destination_ips";
    const currentList = matched.rule[listKey] ?? [];

    const toRemove = new Set(Object.values(remove).filter((v): v is string => Boolean(v)));
    const toAdd = Object.values(add).filter((v): v is string => Boolean(v));
    const nextList = currentList.filter((ip) => !toRemove.has(ip));
    for (const cidr of toAdd) {
      if (!nextList.includes(cidr)) nextList.push(cidr);
    }

    const nextRules = rules.map((rule) => (rule === matched.rule ? { ...rule, [listKey]: nextList } : rule));
    await setFirewallRules(config.apiToken, config.firewallId, nextRules);
  } finally {
    await lock.release();
  }
}

export class HetznerFirewallExecutor implements ActionExecutor<HetznerFirewallResolvedConfig> {
  readonly type = HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE;

  constructor(private readonly redis: Redis) {}

  async execute(
    config: HetznerFirewallResolvedConfig,
    ipValues: ActionExecutionIpValues,
  ): Promise<ActionExecutionResult> {
    const add: Partial<Record<AddressFamily, string>> = {};
    const remove: Partial<Record<AddressFamily, string>> = {};
    const updates: string[] = [];

    (["ipv4", "ipv6"] as const).forEach((family) => {
      const value = ipValues[family];
      if (!value) return;
      add[family] = toCidr(value, family);
      if (config.previousEntries[family]) remove[family] = config.previousEntries[family];
      updates.push(`${family}=${add[family]}`);
    });

    if (updates.length === 0) {
      throw new Error("No IP values supplied to update");
    }

    await applyFirewallRuleUpdate({ redis: this.redis, config, remove, add });

    return { summary: `Updated Hetzner firewall ${config.firewallId} rule: ${updates.join(", ")}` };
  }
}
