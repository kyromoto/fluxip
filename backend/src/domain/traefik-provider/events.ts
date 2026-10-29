export const TRAEFIK_PROVIDER_AGGREGATE_TYPE = "traefik_provider";

export const TraefikProviderEventName = {
  Created: "created",
  Renamed: "renamed",
  Deleted: "deleted",
  TokenIssued: "token_issued",
  TokenRevoked: "token_revoked",
  SnapshotPublished: "snapshot_published",
  SnapshotPublishFailed: "snapshot_publish_failed",
  AgentConnected: "agent_connected",
  AgentDisconnected: "agent_disconnected",
  SnapshotApplied: "snapshot_applied",
  SnapshotApplyFailed: "snapshot_apply_failed",
} as const;

/** Who dials whom. Only "agent_initiated" is implemented (FR-030); "server_initiated" is reserved (FR-031). */
export type ConnectionMode = "agent_initiated" | "server_initiated";

export interface TraefikProviderCreatedData {
  providerId: string;
  accountId: string;
  name: string;
  connectionMode: ConnectionMode;
  createdAt: string;
}

export interface TraefikProviderRenamedData {
  name: string;
  renamedAt: string;
}

export interface TraefikProviderDeletedData {
  deletedAt: string;
}

export interface TraefikProviderTokenIssuedData {
  tokenId: string;
  /** SHA-256 (hex) of the plaintext token; the plaintext is never stored. */
  tokenHash: string;
  last4: string;
  issuedAt: string;
}

export interface TraefikProviderTokenRevokedData {
  tokenId: string;
  revokedAt: string;
}

/** The snapshot's version is this event's sequence number — it is not repeated in the payload. */
export interface TraefikProviderSnapshotPublishedData {
  contentHash: string;
  groupCount: number;
  entryCount: number;
  correlationId: string;
  /** `ip_changed` events folded into this snapshot besides the one that is its `correlationId` (specs/009 research.md §2). */
  absorbedCausationIds?: string[];
  publishedAt: string;
}

export interface TraefikProviderSnapshotPublishFailedData {
  reason: "too_large" | "internal";
  correlationId: string;
  absorbedCausationIds?: string[];
  failedAt: string;
}

export type DisconnectReason = "closed" | "superseded" | "revoked" | "timeout" | "error";

export interface TraefikProviderAgentConnectedData {
  sessionId: string;
  tokenId: string;
  agentVersion: string;
  protocolVersion: number;
  maxOfflineSeconds: number;
  replacedPrevious: boolean;
  connectedAt: string;
}

export interface TraefikProviderAgentDisconnectedData {
  sessionId: string;
  reason: DisconnectReason;
  disconnectedAt: string;
}

export interface FileChecksum {
  name: string;
  sha256: string;
}

export interface TraefikCheckResult {
  status: "ok" | "missing" | "unreachable";
  loaded: string[];
  missing: string[];
}

export interface TraefikProviderSnapshotAppliedData {
  version: number;
  correlationId: string;
  agentVersion: string;
  stale: boolean;
  files: FileChecksum[];
  templates: FileChecksum[];
  traefikCheck?: TraefikCheckResult;
  appliedAt: string;
}

export interface TraefikProviderSnapshotApplyFailedData {
  version: number;
  correlationId: string;
  reason: string;
  appliedAt: string;
}
