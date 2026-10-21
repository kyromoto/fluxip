import type { AgentChannel } from "../../domain/traefik-provider/agent-channel.js";
import type { AgentMessage, CloseReason } from "../../domain/traefik-provider/agent-protocol.js";

export interface ActiveSession {
  providerId: string;
  accountId: string;
  channel: AgentChannel;
  connectedAt: string;
}

/**
 * In-process map of live agent sessions, at most one per provider (FR-034). Single-instance by design
 * (research.md §6); `push` is the seam a cross-instance fan-out would later sit behind.
 */
export class SessionRegistry {
  private readonly byProvider = new Map<string, ActiveSession>();

  /** Registers the newest session and returns the one it replaces, if any. The caller ends the old one. */
  register(session: ActiveSession): ActiveSession | undefined {
    const previous = this.byProvider.get(session.providerId);
    this.byProvider.set(session.providerId, session);
    return previous;
  }

  /** Removes the entry only if it still belongs to this session (a superseded session must not evict its successor). */
  unregister(providerId: string, sessionId: string): boolean {
    const current = this.byProvider.get(providerId);
    if (!current || current.channel.sessionId !== sessionId) return false;
    this.byProvider.delete(providerId);
    return true;
  }

  get(providerId: string): ActiveSession | undefined {
    return this.byProvider.get(providerId);
  }

  isConnected(providerId: string): boolean {
    return this.byProvider.has(providerId);
  }

  /** Sends to the provider's live session. Returns false when no agent is connected. */
  push(providerId: string, message: AgentMessage): boolean {
    const session = this.byProvider.get(providerId);
    if (!session) return false;
    session.channel.send(message);
    return true;
  }

  terminateByToken(providerId: string, tokenId: string, reason: CloseReason): number {
    const session = this.byProvider.get(providerId);
    if (!session || session.channel.tokenId !== tokenId) return 0;
    session.channel.close(reason);
    return 1;
  }

  terminateByProvider(providerId: string, reason: CloseReason): number {
    const session = this.byProvider.get(providerId);
    if (!session) return 0;
    session.channel.close(reason);
    return 1;
  }

  terminateByAccount(accountId: string, reason: CloseReason): number {
    let count = 0;
    for (const session of [...this.byProvider.values()]) {
      if (session.accountId !== accountId) continue;
      session.channel.close(reason);
      count++;
    }
    return count;
  }

  terminateAll(reason: CloseReason): number {
    let count = 0;
    for (const session of [...this.byProvider.values()]) {
      session.channel.close(reason);
      count++;
    }
    return count;
  }

  /** Snapshot of the live sessions, for periodic work. */
  connected(): { accountId: string; providerId: string }[] {
    return [...this.byProvider.values()].map((s) => ({ accountId: s.accountId, providerId: s.providerId }));
  }

  size(): number {
    return this.byProvider.size;
  }
}
