export interface NotificationMessage {
  addresses: string[];
  subject: string;
  body: string;
}

/**
 * One implementation per channel type (research.md §13) — email today, other
 * channels (FR-031) can be added later as new adapters behind this same port.
 */
export interface NotificationChannel {
  readonly type: string;
  send(message: NotificationMessage): Promise<void>;
}
