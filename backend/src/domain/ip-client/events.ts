export const IP_CLIENT_AGGREGATE_TYPE = "ip_client";

export const IpClientEventName = {
  Registered: "registered",
  CredentialRotated: "credential_rotated",
  Enabled: "enabled",
  Disabled: "disabled",
  Decommissioned: "decommissioned",
  IpReportReceived: "ip_report_received",
  IpChanged: "ip_changed",
  NotificationPreferenceSet: "notification_preference_set",
} as const;

export type NotificationPreference = "off" | "failures_only" | "all";

export interface IpClientRegisteredData {
  ipClientId: string;
  accountId: string;
  label: string;
  credentialHash: string;
  registeredAt: string;
}

export interface IpClientCredentialRotatedData {
  credentialHash: string;
  rotatedAt: string;
}

export interface IpClientEnabledData {
  ipClientId: string;
}

export interface IpClientDisabledData {
  ipClientId: string;
}

export interface IpClientDecommissionedData {
  decommissionedAt: string;
}

export interface IpClientIpReportReceivedData {
  reportedIPv4?: string;
  reportedIPv6?: string;
  receivedAt: string;
}

export interface IpClientIpChangedData {
  previousIPv4?: string;
  newIPv4?: string;
  previousIPv6?: string;
  newIPv6?: string;
  settledAt: string;
}

export interface IpClientNotificationPreferenceSetData {
  notificationPreference: NotificationPreference;
}
