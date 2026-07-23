import type { StoredEvent } from "../../ports/event-store.js";
import {
  IpClientEventName,
  type IpClientCredentialRotatedData,
  type IpClientIpChangedData,
  type IpClientNotificationPreferenceSetData,
  type IpClientRegisteredData,
  type NotificationPreference,
} from "./events.js";

export interface IpClientState {
  ipClientId: string | null;
  accountId: string | null;
  label: string;
  credentialHash: string | null;
  status: "enabled" | "disabled" | "decommissioned";
  lastKnownIPv4: string | null;
  lastKnownIPv6: string | null;
  notificationPreference: NotificationPreference;
}

export const initialIpClientState: IpClientState = {
  ipClientId: null,
  accountId: null,
  label: "",
  credentialHash: null,
  status: "enabled",
  lastKnownIPv4: null,
  lastKnownIPv6: null,
  notificationPreference: "off",
};

export function ipClientReducer(state: IpClientState, event: StoredEvent): IpClientState {
  switch (event.eventName) {
    case IpClientEventName.Registered: {
      const data = event.data as IpClientRegisteredData;
      return {
        ...state,
        ipClientId: data.ipClientId,
        accountId: data.accountId,
        label: data.label,
        credentialHash: data.credentialHash,
        status: "enabled",
      };
    }
    case IpClientEventName.CredentialRotated: {
      const data = event.data as IpClientCredentialRotatedData;
      return { ...state, credentialHash: data.credentialHash };
    }
    case IpClientEventName.Enabled:
      return { ...state, status: "enabled" };
    case IpClientEventName.Disabled:
      return { ...state, status: "disabled" };
    case IpClientEventName.Decommissioned:
      return { ...state, status: "decommissioned" };
    case IpClientEventName.IpChanged: {
      const data = event.data as IpClientIpChangedData;
      return {
        ...state,
        lastKnownIPv4: data.newIPv4 ?? state.lastKnownIPv4,
        lastKnownIPv6: data.newIPv6 ?? state.lastKnownIPv6,
      };
    }
    case IpClientEventName.NotificationPreferenceSet: {
      const data = event.data as IpClientNotificationPreferenceSetData;
      return { ...state, notificationPreference: data.notificationPreference };
    }
    default:
      return state;
  }
}
