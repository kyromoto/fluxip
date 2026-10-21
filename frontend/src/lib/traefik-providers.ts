import { ApiError } from "~/services/api";

export type ProviderConnectionState = "never_connected" | "connected" | "disconnected" | "stale";
export type DeliveryStatus = "applied" | "pending" | "error" | "agent_disconnected" | "disabled";

export interface ProviderToken {
  tokenId: string;
  last4: string;
  issuedAt: string;
  status: "valid" | "revoked";
}

export interface TraefikProviderSummary {
  providerId: string;
  name: string;
  connectionMode: "agent_initiated" | "server_initiated";
  agentAddress: string;
  state: ProviderConnectionState;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  appliedVersion: number | null;
  publishedVersion: number | null;
  agentVersion: string | null;
  lastError: { version: number; reason: string; at: string } | null;
  lastPublishError: { reason: string; at: string } | null;
  notices: string[];
  tokens: ProviderToken[];
  actionCount: number;
}

export interface TraefikProviderDetail extends TraefikProviderSummary {
  usedBy: { actionId: string; ipClientId: string; ipClientName: string; group: string; status: string }[];
  groups: string[];
}

export interface CreatedProvider {
  providerId: string;
  name: string;
  connectionMode: string;
  agentAddress: string;
  token: { tokenId: string; value: string; last4: string };
  setup: { startCommand: string; traefikSnippet: string; notes: string[] };
}

export interface DeliveryStatusItem {
  actionId: string;
  traefikProviderId: string;
  providerName: string;
  group: string;
  status: DeliveryStatus;
  publishedVersion: number | null;
  appliedVersion: number | null;
  error: { reason: string; at: string } | null;
}

export const STATE_LABEL: Record<ProviderConnectionState, string> = {
  never_connected: "Never connected",
  connected: "Connected",
  disconnected: "Disconnected",
  stale: "Stale",
};

export const STATE_HINT: Record<ProviderConnectionState, string> = {
  never_connected: "No agent has connected yet.",
  connected: "The agent is online.",
  disconnected: "The agent is offline. Its files stay as they were.",
  stale: "The agent has been offline longer than its maximum offline duration and now uses fallback data.",
};

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  applied: "Applied",
  pending: "Pending",
  error: "Failed",
  agent_disconnected: "Agent disconnected",
  disabled: "Disabled",
};

export const NOTICE_LABEL: Record<string, string> = {
  previous_session_superseded: "A second agent connected with the same credentials; the first one was disconnected.",
};

export function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Parses a JSON error body out of an ApiError; null for any other error shape. */
export function parseApiError<T extends { error?: string }>(err: unknown, status?: number): T | null {
  if (!(err instanceof ApiError) || (status !== undefined && err.status !== status)) return null;
  try {
    return JSON.parse(err.message) as T;
  } catch {
    return null;
  }
}

/** Matches the server's group rule (1-63 chars: lowercase letters, digits, '.', '_', '-'; starts alphanumeric). */
export const GROUP_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
