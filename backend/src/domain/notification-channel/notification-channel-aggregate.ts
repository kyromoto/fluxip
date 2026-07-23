import type { StoredEvent } from "../../ports/event-store.js";
import {
  NotificationChannelEventName,
  type NotificationChannelReconfiguredData,
  type NotificationChannelRegisteredData,
} from "./events.js";

export interface NotificationChannelState {
  channelId: string | null;
  accountId: string | null;
  type: string;
  addresses: string[];
  status: "active" | "revoked";
}

export const initialNotificationChannelState: NotificationChannelState = {
  channelId: null,
  accountId: null,
  type: "",
  addresses: [],
  status: "active",
};

export function notificationChannelReducer(
  state: NotificationChannelState,
  event: StoredEvent,
): NotificationChannelState {
  switch (event.eventName) {
    case NotificationChannelEventName.Registered: {
      const data = event.data as NotificationChannelRegisteredData;
      return {
        ...state,
        channelId: data.channelId,
        accountId: data.accountId,
        type: data.type,
        addresses: data.addresses,
        status: "active",
      };
    }
    case NotificationChannelEventName.Reconfigured: {
      const data = event.data as NotificationChannelReconfiguredData;
      return { ...state, addresses: data.addresses };
    }
    case NotificationChannelEventName.Revoked:
      return { ...state, status: "revoked" };
    default:
      return state;
  }
}
