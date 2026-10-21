import { ulid } from "ulid";
import type { Config } from "../../config/env.js";
import { getAppLogger } from "../../observability/app-logger.js";
import type { AgentChannel } from "./agent-channel.js";
import { PROTOCOL_MAX_VERSION, PROTOCOL_MIN_VERSION, type AgentMessage, type CloseReason } from "./agent-protocol.js";
import {
  TraefikProviderEventName,
  type DisconnectReason,
  type TraefikProviderAgentConnectedData,
  type TraefikProviderAgentDisconnectedData,
  type TraefikProviderSnapshotAppliedData,
  type TraefikProviderSnapshotApplyFailedData,
} from "./events.js";
import type { ProviderStore } from "./provider-store.js";
import type { SnapshotPayload } from "./snapshot.js";

const logger = getAppLogger(["agent-session"]);

/** Missed heartbeat intervals before a silent peer is dropped (contracts/agent-session.proto.md, rule 7). */
const HEARTBEAT_MISSES_ALLOWED = 3;

/** What the handler needs from the live-session registry (implemented in adapters/agent-grpc). */
export interface SessionRegistryPort {
  register(session: { providerId: string; accountId: string; channel: AgentChannel; connectedAt: string }): { channel: AgentChannel } | undefined;
  unregister(providerId: string, sessionId: string): boolean;
}

/** What the handler needs to obtain the snapshot an agent should hold (implemented by the SnapshotPublisher). */
export interface SnapshotSource {
  publishNow(accountId: string, providerId: string, causationId?: string): Promise<SnapshotPayload | null>;
}

export interface AgentSessionHandlerDeps {
  providerId: string;
  accountId: string;
  channel: AgentChannel;
  store: ProviderStore;
  publisher: SnapshotSource;
  registry: SessionRegistryPort;
  config: Config;
  /** Version string advertised to the agent. */
  serverVersion?: string;
  now?: () => number;
}

/**
 * The session logic after a connection exists — deliberately unaware of who opened it (FR-032).
 * It only talks to an {@link AgentChannel}, so a later server-initiated adapter reuses it unchanged.
 */
export class AgentSessionHandler {
  private helloSeen = false;
  private connectedRecorded = false;
  private closed = false;
  private finished = false;
  private disconnectRecorded = false;
  private closeReason: CloseReason | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastReceivedAt: number;
  private chain: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly deps: AgentSessionHandlerDeps) {
    this.now = deps.now ?? Date.now;
    this.lastReceivedAt = this.now();
  }

  /** Messages are processed strictly in arrival order. */
  handle(message: AgentMessage): Promise<void> {
    this.chain = this.chain.then(() => this.process(message)).catch((err: unknown) => {
      logger.error("Session {sessionId} failed while handling {type}: {error}", {
        ...this.logContext(),
        type: message.type,
        error: err instanceof Error ? err.message : String(err),
      });
      this.terminate({ code: "internal", message: "internal error", disconnect: "error" });
    });
    return this.chain;
  }

  /** Called by the adapter once the transport is gone. Idempotent. */
  async onClosed(reason?: CloseReason): Promise<void> {
    if (this.closed && this.finished) return;
    this.closed = true;
    this.finished = true;
    this.stopHeartbeat();
    const effective = reason ?? this.closeReason ?? { code: "ok", message: "closed", disconnect: "closed" as DisconnectReason };
    this.deps.registry.unregister(this.deps.providerId, this.deps.channel.sessionId);
    await this.chain.catch(() => undefined);
    if (!this.connectedRecorded || this.disconnectRecorded) return;
    this.disconnectRecorded = true;
    // The account may have been closed meanwhile; never recreate events for a provider that no longer exists.
    const stillThere = await this.deps.store.load(this.deps.accountId, this.deps.providerId);
    if (!stillThere.state.providerId) return;
    const data: TraefikProviderAgentDisconnectedData = {
      sessionId: this.deps.channel.sessionId,
      reason: effective.disconnect,
      disconnectedAt: new Date(this.now()).toISOString(),
    };
    try {
      await this.deps.store.append(this.deps.accountId, this.deps.providerId, TraefikProviderEventName.AgentDisconnected, data);
    } catch (err) {
      logger.error("Could not record disconnect for session {sessionId}: {error}", {
        ...this.logContext(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private logContext(): Record<string, unknown> {
    return { accountId: this.deps.accountId, providerId: this.deps.providerId, sessionId: this.deps.channel.sessionId };
  }

  private terminate(reason: CloseReason): void {
    if (this.closeReason) return;
    this.closeReason = reason;
    this.deps.channel.close(reason);
  }

  private async process(message: AgentMessage): Promise<void> {
    if (this.closed) return;
    this.lastReceivedAt = this.now();

    if (!this.helloSeen) {
      if (message.type !== "hello") {
        this.terminate({ code: "failed_precondition", message: "hello must be the first message", disconnect: "error" });
        return;
      }
      await this.onHello(message);
      return;
    }

    switch (message.type) {
      case "hello":
        logger.warning("Session {sessionId} sent a second hello; ignored", this.logContext());
        return;
      case "report":
        await this.onReport(message);
        return;
      case "syncRequest":
        await this.sendCurrentSnapshot();
        return;
      case "heartbeat":
        return;
      case "bye":
        this.terminate({ code: "ok", message: message.reason || "agent said bye", disconnect: "closed" });
        return;
      case "snapshot":
        logger.warning("Session {sessionId} sent a snapshot; agents never do. Ignored", this.logContext());
        return;
    }
  }

  private async onHello(hello: Extract<AgentMessage, { type: "hello" }>): Promise<void> {
    const accepted = Math.min(hello.protocolVersion, PROTOCOL_MAX_VERSION);
    if (accepted < PROTOCOL_MIN_VERSION) {
      this.terminate({
        code: "failed_precondition",
        message: `protocol_version_unsupported: agent speaks v${hello.protocolVersion}, server supports v${PROTOCOL_MIN_VERSION}..v${PROTOCOL_MAX_VERSION}, update the agent`,
        disconnect: "error",
      });
      return;
    }
    this.helloSeen = true;

    const { providerId, accountId, channel, config } = this.deps;
    const replaced = this.deps.registry.register({
      providerId,
      accountId,
      channel,
      connectedAt: new Date(this.now()).toISOString(),
    });
    if (replaced) {
      replaced.channel.send({ type: "bye", reason: "superseded" });
      replaced.channel.close({ code: "aborted", message: "superseded by a newer connection", disconnect: "superseded" });
    }

    const connected: TraefikProviderAgentConnectedData = {
      sessionId: channel.sessionId,
      tokenId: channel.tokenId,
      agentVersion: hello.agentVersion,
      protocolVersion: accepted,
      maxOfflineSeconds: hello.maxOfflineSeconds,
      replacedPrevious: !!replaced,
      connectedAt: new Date(this.now()).toISOString(),
    };
    await this.deps.store.append(accountId, providerId, TraefikProviderEventName.AgentConnected, connected);
    this.connectedRecorded = true;

    const loaded = await this.deps.store.loadActive(accountId, providerId);
    channel.send({
      type: "hello",
      protocolVersion: PROTOCOL_MAX_VERSION,
      agentVersion: this.deps.serverVersion ?? "fluxip",
      maxOfflineSeconds: 0,
      heartbeatSeconds: config.agentHeartbeatSeconds,
      maxSnapshotBytes: config.agentSnapshotMaxBytes,
      providerName: loaded?.state.name ?? "",
      acceptedVersion: accepted,
    });
    logger.info("Agent {agentVersion} connected (protocol v{protocolVersion})", {
      ...this.logContext(),
      agentVersion: hello.agentVersion,
      protocolVersion: accepted,
      replacedPrevious: !!replaced,
    });

    await this.sendCurrentSnapshot();
    this.startHeartbeat(config.agentHeartbeatSeconds);
  }

  private async sendCurrentSnapshot(): Promise<void> {
    const snapshot = await this.deps.publisher.publishNow(this.deps.accountId, this.deps.providerId);
    if (!snapshot) return;
    this.deps.channel.send({ type: "snapshot", ...snapshot });
  }

  private async onReport(report: Extract<AgentMessage, { type: "report" }>): Promise<void> {
    const { accountId, providerId, store } = this.deps;
    const appliedAt = new Date(this.now()).toISOString();
    logger.info("Report for version {version}: {result}", {
      ...this.logContext(),
      version: report.version,
      correlationId: report.correlationId,
      result: report.result,
    });

    if (report.result === "ignored_stale") return;
    if (report.result === "ok") {
      const data: TraefikProviderSnapshotAppliedData = {
        version: report.version,
        correlationId: report.correlationId,
        agentVersion: report.agentVersion,
        stale: report.stale,
        files: report.files,
        templates: report.templates,
        traefikCheck: report.traefikCheck,
        appliedAt,
      };
      await store.append(accountId, providerId, TraefikProviderEventName.SnapshotApplied, data);
      return;
    }
    const failed: TraefikProviderSnapshotApplyFailedData = {
      version: report.version,
      correlationId: report.correlationId,
      reason: report.error || "unknown error",
      appliedAt,
    };
    await store.append(accountId, providerId, TraefikProviderEventName.SnapshotApplyFailed, failed);
  }

  private startHeartbeat(seconds: number): void {
    const intervalMs = Math.max(1, seconds) * 1000;
    let nonce = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.closed) return;
      if (this.now() - this.lastReceivedAt > intervalMs * HEARTBEAT_MISSES_ALLOWED) {
        logger.warning("Session {sessionId} timed out (no message for {seconds}s)", {
          ...this.logContext(),
          seconds: Math.round((this.now() - this.lastReceivedAt) / 1000),
        });
        this.terminate({ code: "deadline_exceeded", message: "heartbeat timeout", disconnect: "timeout" });
        return;
      }
      this.deps.channel.send({ type: "heartbeat", nonce: ++nonce });
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** A fresh session id for adapters that create channels. */
  static newSessionId(): string {
    return ulid();
  }
}
