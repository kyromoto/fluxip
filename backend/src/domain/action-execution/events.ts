export const ACTION_EXECUTION_AGGREGATE_TYPE = "action_execution";

export const ActionExecutionEventName = {
  Started: "started",
  Succeeded: "succeeded",
  Failed: "failed",
  RetryScheduled: "retry_scheduled",
  NotificationSent: "notification_sent",
} as const;

export type TriggeredBy = "ip_change" | "manual";

export interface IpValuesUsed {
  ipv4?: string;
  ipv6?: string;
}

export interface ActionExecutionStartedData {
  executionId: string;
  accountId: string;
  actionId: string;
  ipClientId: string;
  triggeredBy: TriggeredBy;
  causationEventId: string;
  ipValuesUsed: IpValuesUsed;
  attempt: number;
  startedAt: string;
}

export interface ActionExecutionSucceededData {
  completedAt: string;
  providerResponseSummary: string;
}

export interface ActionExecutionFailedData {
  attempt: number;
  error: string;
  retriesExhausted: boolean;
  failedAt: string;
}

export interface ActionExecutionRetryScheduledData {
  nextAttempt: number;
  nextAttemptAt: string;
}

export interface ActionExecutionNotificationSentData {
  channelId: string;
  outcomeNotified: "succeeded" | "failed";
  sentAt: string;
}
