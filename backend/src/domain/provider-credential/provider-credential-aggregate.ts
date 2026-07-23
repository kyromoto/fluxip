import type { StoredEvent } from "../../ports/event-store.js";
import {
  ProviderCredentialEventName,
  type ProviderCredentialRotatedData,
  type ProviderCredentialStoredData,
} from "./events.js";

export interface ProviderCredentialState {
  credentialId: string | null;
  accountId: string | null;
  provider: string;
  label: string;
  encryptedSecret: string | null;
  secretLast4: string;
  status: "active" | "revoked";
}

export const initialProviderCredentialState: ProviderCredentialState = {
  credentialId: null,
  accountId: null,
  provider: "",
  label: "",
  encryptedSecret: null,
  secretLast4: "",
  status: "active",
};

export function providerCredentialReducer(
  state: ProviderCredentialState,
  event: StoredEvent,
): ProviderCredentialState {
  switch (event.eventName) {
    case ProviderCredentialEventName.Stored: {
      const data = event.data as ProviderCredentialStoredData;
      return {
        ...state,
        credentialId: data.credentialId,
        accountId: data.accountId,
        provider: data.provider,
        label: data.label,
        encryptedSecret: data.encryptedSecret,
        secretLast4: data.secretLast4,
        status: "active",
      };
    }
    case ProviderCredentialEventName.Rotated: {
      const data = event.data as ProviderCredentialRotatedData;
      return { ...state, encryptedSecret: data.encryptedSecret };
    }
    case ProviderCredentialEventName.Revoked:
      return { ...state, status: "revoked" };
    default:
      return state;
  }
}
