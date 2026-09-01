export const ACTION_AGGREGATE_TYPE = "action";

export const ActionEventName = {
  Attached: "attached",
  Reconfigured: "reconfigured",
  Enabled: "enabled",
  Disabled: "disabled",
  Detached: "detached",
  FirewallRuleApplied: "firewall_rule_applied",
} as const;

export type AddressFamily = "ipv4" | "ipv6";

/** The first Action type built (FR-008 of 001); more can be added without touching this shape's callers (FR-009 of 001). */
export const HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE = "hetzner_cloud_dns_update";
/** Second Action type (007-hetzner-firewall-action) — anticipated by FR-009/FR-035 of 001. */
export const HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE = "hetzner_cloud_firewall_rule_update";

export interface UpdateDnsRecordConfig {
  providerCredentialId: string;
  zone: string;
  recordName: string;
}

/** The "rule selector" from spec.md FR-003/FR-018 — direction+protocol+port+description together must resolve to exactly one rule. */
export interface UpdateFirewallRuleConfig {
  providerCredentialId: string;
  /** Hetzner Cloud Firewalls are int-identified, not UUID-identified (contracts/hetzner-firewall-api.md). */
  firewallId: number;
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "icmp" | "esp" | "ah" | "gre";
  /** Only meaningful (and only ever present) when protocol is "tcp" or "udp". */
  port?: string;
  description: string;
}

export type ActionConfig = UpdateDnsRecordConfig | UpdateFirewallRuleConfig;

export interface ActionAttachedData {
  actionId: string;
  accountId: string;
  ipClientId: string;
  type: string;
  addressFamilies: AddressFamily[];
  config: ActionConfig;
  attachedAt: string;
}

export interface ActionReconfiguredData {
  addressFamilies?: AddressFamily[];
  config?: ActionConfig;
  reconfiguredAt: string;
}

export interface ActionEnabledData {
  actionId: string;
}

export interface ActionDisabledData {
  actionId: string;
}

export interface ActionDetachedData {
  detachedAt: string;
}

/**
 * NEW for the Firewall Rule Update Action (research.md §1/§4 of 007-hetzner-firewall-action) —
 * appended by the action-execution worker (not an HTTP route) after a successful firewall write,
 * carrying only the address-family/CIDR pairs actually written in that execution. Folded into
 * ActionState.firewallOwnedEntries, overwriting only the families present here.
 */
export interface ActionFirewallRuleAppliedData {
  actionId: string;
  ipv4?: string;
  ipv6?: string;
  appliedAt: string;
}
