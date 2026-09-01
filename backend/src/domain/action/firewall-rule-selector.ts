import type { UpdateFirewallRuleConfig } from "./events.js";

/** One rule as returned by Hetzner's `GET /firewalls/{id}` (contracts/hetzner-firewall-api.md). */
export interface HetznerFirewallRule {
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "icmp" | "esp" | "ah" | "gre";
  port?: string;
  source_ips?: string[];
  destination_ips?: string[];
  description?: string;
}

export type RuleSelector = Pick<UpdateFirewallRuleConfig, "direction" | "protocol" | "port" | "description">;

export type MatchFirewallRuleResult =
  | { rule: HetznerFirewallRule }
  | { error: "no_match" }
  | { error: "ambiguous_match"; matchCount: number };

/**
 * Pure, I/O-free rule matching shared by config-time validation (FR-018) and execution-time
 * validation (FR-008) so the two can never drift (research.md §5 of 007-hetzner-firewall-action).
 * direction+protocol+port+description together must resolve to exactly one rule — description is
 * required specifically because the other three alone aren't guaranteed unique (spec.md FR-003).
 */
export function matchFirewallRule(rules: HetznerFirewallRule[], selector: RuleSelector): MatchFirewallRuleResult {
  const matches = rules.filter(
    (rule) =>
      rule.direction === selector.direction &&
      rule.protocol === selector.protocol &&
      (rule.port ?? undefined) === (selector.port ?? undefined) &&
      (rule.description ?? "") === selector.description,
  );

  if (matches.length === 0) return { error: "no_match" };
  if (matches.length > 1) return { error: "ambiguous_match", matchCount: matches.length };
  // length === 1 was just checked, so this index is always present.
  return { rule: matches[0]! };
}
