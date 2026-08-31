export const ACTION_AGGREGATE_TYPE = "action";

export const ActionEventName = {
  Attached: "attached",
  Reconfigured: "reconfigured",
  Enabled: "enabled",
  Disabled: "disabled",
  Detached: "detached",
} as const;

export type AddressFamily = "ipv4" | "ipv6";

/** The only Action type in this iteration (FR-008); more can be added without touching this shape's callers (FR-009). */
export const HETZNER_CLOUD_DNS_UPDATE_ACTION_TYPE = "hetzner_cloud_dns_update";

export interface UpdateDnsRecordConfig {
  providerCredentialId: string;
  zone: string;
  recordName: string;
}

export type ActionConfig = UpdateDnsRecordConfig;

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
