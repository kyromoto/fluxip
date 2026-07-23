export const NOTIFICATION_CHANNEL_AGGREGATE_TYPE = "notification_channel";

export const NotificationChannelEventName = {
  Registered: "registered",
  Reconfigured: "reconfigured",
  Revoked: "revoked",
} as const;

/** The only channel type in this iteration (FR-028); more can be added without touching callers (FR-031). */
export const EMAIL_NOTIFICATION_CHANNEL_TYPE = "email";

export interface NotificationChannelRegisteredData {
  channelId: string;
  accountId: string;
  type: string;
  addresses: string[];
  registeredAt: string;
}

export interface NotificationChannelReconfiguredData {
  addresses: string[];
  reconfiguredAt: string;
}

export interface NotificationChannelRevokedData {
  revokedAt: string;
}
