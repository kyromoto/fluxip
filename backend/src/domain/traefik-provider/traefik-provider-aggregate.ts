import type { StoredEvent } from "../../ports/event-store.js";
import {
  TraefikProviderEventName,
  type ConnectionMode,
  type FileChecksum,
  type TraefikCheckResult,
  type TraefikProviderAgentConnectedData,
  type TraefikProviderAgentDisconnectedData,
  type TraefikProviderCreatedData,
  type TraefikProviderRenamedData,
  type TraefikProviderSnapshotAppliedData,
  type TraefikProviderSnapshotApplyFailedData,
  type TraefikProviderSnapshotPublishFailedData,
  type TraefikProviderSnapshotPublishedData,
  type TraefikProviderTokenIssuedData,
  type TraefikProviderTokenRevokedData,
} from "./events.js";

export const MAX_ACTIVE_TOKENS = 2;

export interface ProviderTokenState {
  tokenId: string;
  hash: string;
  last4: string;
  issuedAt: string;
  revokedAt?: string;
}

export interface TraefikProviderState {
  providerId: string | null;
  accountId: string | null;
  name: string;
  connectionMode: ConnectionMode;
  status: "active" | "deleted";
  tokens: ProviderTokenState[];
  lastPublished: { version: number; contentHash: string; correlationId: string; publishedAt: string } | null;
  lastPublishError: { reason: string; correlationId: string; failedAt: string } | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  /** Mirrors the event order only; the live truth is the in-process session registry (research.md §6). */
  lastPresence: "connected" | "disconnected" | "never";
  agentVersion: string | null;
  maxOfflineSeconds: number | null;
  replacedPreviousAt: string | null;
  lastApplied: {
    version: number;
    correlationId: string;
    stale: boolean;
    files: FileChecksum[];
    templates: FileChecksum[];
    traefikCheck?: TraefikCheckResult;
    appliedAt: string;
  } | null;
  lastApplyError: { version: number; correlationId: string; reason: string; appliedAt: string } | null;
}

export const initialTraefikProviderState: TraefikProviderState = {
  providerId: null,
  accountId: null,
  name: "",
  connectionMode: "agent_initiated",
  status: "active",
  tokens: [],
  lastPublished: null,
  lastPublishError: null,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastPresence: "never",
  agentVersion: null,
  maxOfflineSeconds: null,
  replacedPreviousAt: null,
  lastApplied: null,
  lastApplyError: null,
};

export function activeTokens(state: TraefikProviderState): ProviderTokenState[] {
  return state.tokens.filter((token) => !token.revokedAt);
}

export function traefikProviderReducer(state: TraefikProviderState, event: StoredEvent): TraefikProviderState {
  switch (event.eventName) {
    case TraefikProviderEventName.Created: {
      const data = event.data as TraefikProviderCreatedData;
      return {
        ...state,
        providerId: data.providerId,
        accountId: data.accountId,
        name: data.name,
        connectionMode: data.connectionMode,
        status: "active",
      };
    }
    case TraefikProviderEventName.Renamed:
      return { ...state, name: (event.data as TraefikProviderRenamedData).name };
    case TraefikProviderEventName.Deleted:
      return { ...state, status: "deleted" };
    case TraefikProviderEventName.TokenIssued: {
      const data = event.data as TraefikProviderTokenIssuedData;
      return {
        ...state,
        tokens: [...state.tokens, { tokenId: data.tokenId, hash: data.tokenHash, last4: data.last4, issuedAt: data.issuedAt }],
      };
    }
    case TraefikProviderEventName.TokenRevoked: {
      const data = event.data as TraefikProviderTokenRevokedData;
      return {
        ...state,
        tokens: state.tokens.map((token) =>
          token.tokenId === data.tokenId && !token.revokedAt ? { ...token, revokedAt: data.revokedAt } : token,
        ),
      };
    }
    case TraefikProviderEventName.SnapshotPublished: {
      const data = event.data as TraefikProviderSnapshotPublishedData;
      return {
        ...state,
        lastPublished: {
          version: event.sequenceNumber,
          contentHash: data.contentHash,
          correlationId: data.correlationId,
          publishedAt: data.publishedAt,
        },
        lastPublishError: null,
      };
    }
    case TraefikProviderEventName.SnapshotPublishFailed: {
      const data = event.data as TraefikProviderSnapshotPublishFailedData;
      return {
        ...state,
        lastPublishError: { reason: data.reason, correlationId: data.correlationId, failedAt: data.failedAt },
      };
    }
    case TraefikProviderEventName.AgentConnected: {
      const data = event.data as TraefikProviderAgentConnectedData;
      return {
        ...state,
        lastConnectedAt: data.connectedAt,
        lastPresence: "connected",
        agentVersion: data.agentVersion,
        maxOfflineSeconds: data.maxOfflineSeconds,
        replacedPreviousAt: data.replacedPrevious ? data.connectedAt : state.replacedPreviousAt,
      };
    }
    case TraefikProviderEventName.AgentDisconnected: {
      const data = event.data as TraefikProviderAgentDisconnectedData;
      // A superseded session ends *after* its replacement connected; the newer connection stays authoritative.
      if (data.reason === "superseded") return { ...state, lastDisconnectedAt: data.disconnectedAt };
      return { ...state, lastDisconnectedAt: data.disconnectedAt, lastPresence: "disconnected" };
    }
    case TraefikProviderEventName.SnapshotApplied: {
      const data = event.data as TraefikProviderSnapshotAppliedData;
      return {
        ...state,
        agentVersion: data.agentVersion || state.agentVersion,
        lastApplied: {
          version: data.version,
          correlationId: data.correlationId,
          stale: data.stale,
          files: data.files,
          templates: data.templates,
          traefikCheck: data.traefikCheck,
          appliedAt: data.appliedAt,
        },
        lastApplyError: null,
      };
    }
    case TraefikProviderEventName.SnapshotApplyFailed: {
      const data = event.data as TraefikProviderSnapshotApplyFailedData;
      return {
        ...state,
        lastApplyError: {
          version: data.version,
          correlationId: data.correlationId,
          reason: data.reason,
          appliedAt: data.appliedAt,
        },
      };
    }
    default:
      return state;
  }
}
