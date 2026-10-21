import type { AgentMessage, CloseReason } from "./agent-protocol.js";

/**
 * The seam that keeps the session logic independent of who opened the connection (FR-032, SC-008).
 * Variant A implements it over an incoming gRPC stream; a later variant B over an outgoing one.
 */
export interface AgentChannel {
  readonly sessionId: string;
  /** The token the peer authenticated with, so revoking it can end exactly this session. */
  readonly tokenId: string;
  send(message: AgentMessage): void;
  close(reason: CloseReason): void;
}
