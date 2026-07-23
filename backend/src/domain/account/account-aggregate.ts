import type { StoredEvent } from "../../ports/event-store.js";
import {
  AccountEventName,
  type AccountDeviceLimitOverriddenData,
  type AccountRegisteredData,
} from "./events.js";

export interface AccountState {
  accountId: string | null;
  deviceLimit: number;
  status: "active" | "closed";
}

export const initialAccountState: AccountState = {
  accountId: null,
  deviceLimit: 0,
  status: "active",
};

export function accountReducer(state: AccountState, event: StoredEvent): AccountState {
  switch (event.eventName) {
    case AccountEventName.Registered: {
      const data = event.data as AccountRegisteredData;
      return { accountId: data.accountId, deviceLimit: data.deviceLimit, status: "active" };
    }
    case AccountEventName.DeviceLimitOverridden: {
      const data = event.data as AccountDeviceLimitOverriddenData;
      return { ...state, deviceLimit: data.newLimit };
    }
    case AccountEventName.Closed: {
      return { ...state, status: "closed" };
    }
    default:
      return state;
  }
}
