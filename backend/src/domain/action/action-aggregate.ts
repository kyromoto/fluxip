import type { StoredEvent } from "../../ports/event-store.js";
import {
  ActionEventName,
  type ActionAttachedData,
  type ActionConfig,
  type ActionReconfiguredData,
  type AddressFamily,
} from "./events.js";

export interface ActionState {
  actionId: string | null;
  accountId: string | null;
  ipClientId: string | null;
  type: string | null;
  addressFamilies: AddressFamily[];
  config: ActionConfig | null;
  status: "enabled" | "disabled" | "detached";
}

export const initialActionState: ActionState = {
  actionId: null,
  accountId: null,
  ipClientId: null,
  type: null,
  addressFamilies: [],
  config: null,
  status: "enabled",
};

export function actionReducer(state: ActionState, event: StoredEvent): ActionState {
  switch (event.eventName) {
    case ActionEventName.Attached: {
      const data = event.data as ActionAttachedData;
      return {
        ...state,
        actionId: data.actionId,
        accountId: data.accountId,
        ipClientId: data.ipClientId,
        type: data.type,
        addressFamilies: data.addressFamilies,
        config: data.config,
        status: "enabled",
      };
    }
    case ActionEventName.Reconfigured: {
      const data = event.data as ActionReconfiguredData;
      return {
        ...state,
        addressFamilies: data.addressFamilies ?? state.addressFamilies,
        config: data.config ?? state.config,
      };
    }
    case ActionEventName.Enabled:
      return { ...state, status: "enabled" };
    case ActionEventName.Disabled:
      return { ...state, status: "disabled" };
    case ActionEventName.Detached:
      return { ...state, status: "detached" };
    default:
      return state;
  }
}
