import type { DisconnectReason, TraefikCheckResult, FileChecksum } from "./events.js";
import type { SnapshotPayload } from "./snapshot.js";

/** Transport-neutral form of the session protocol (contracts/agent-session.proto.md). */
export type AgentMessage =
  | {
      type: "hello";
      protocolVersion: number;
      agentVersion: string;
      maxOfflineSeconds: number;
      heartbeatSeconds: number;
      maxSnapshotBytes: number;
      providerName: string;
      acceptedVersion: number;
    }
  | ({ type: "snapshot" } & SnapshotPayload)
  | {
      type: "report";
      version: number;
      correlationId: string;
      result: "ok" | "error" | "ignored_stale";
      error: string;
      agentVersion: string;
      stale: boolean;
      files: FileChecksum[];
      templates: FileChecksum[];
      traefikCheck?: TraefikCheckResult;
    }
  | { type: "heartbeat"; nonce: number }
  | { type: "syncRequest" }
  | { type: "bye"; reason: string };

export const PROTOCOL_MIN_VERSION = 1;
export const PROTOCOL_MAX_VERSION = 1;

/** How a session ends, independent of transport. Adapters map `code` to their own status. */
export interface CloseReason {
  code: "ok" | "unauthenticated" | "failed_precondition" | "aborted" | "unavailable" | "deadline_exceeded" | "internal";
  message: string;
  disconnect: DisconnectReason;
}
