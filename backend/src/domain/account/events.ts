export const ACCOUNT_AGGREGATE_TYPE = "account";

export const AccountEventName = {
  Registered: "registered",
  DeviceLimitOverridden: "device_limit_overridden",
  Closed: "closed",
} as const;

export interface AccountRegisteredData {
  accountId: string;
  deviceLimit: number;
  registeredAt: string;
}

export interface AccountDeviceLimitOverriddenData {
  accountId: string;
  previousLimit: number;
  newLimit: number;
  overriddenBy: string;
  overriddenAt: string;
}

export interface AccountClosedData {
  accountId: string;
  closedAt: string;
}
