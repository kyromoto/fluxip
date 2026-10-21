import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { Config } from "../../config/env.js";
import { AgentSessionHandler, type SnapshotSource } from "../../domain/traefik-provider/agent-session-handler.js";
import type { AgentChannel } from "../../domain/traefik-provider/agent-channel.js";
import type { AgentMessage, CloseReason } from "../../domain/traefik-provider/agent-protocol.js";
import { activeTokens } from "../../domain/traefik-provider/traefik-provider-aggregate.js";
import type { ProviderStore } from "../../domain/traefik-provider/provider-store.js";
import { verifyAgentToken } from "../../domain/traefik-provider/token.js";
import { getAppLogger } from "../../observability/app-logger.js";
import { decodeEnvelope, encodeEnvelope, type WireEnvelope } from "./proto-codec.js";
import type { SessionRegistry } from "./session-registry.js";

const logger = getAppLogger(["agent-grpc"]);

/** The one message every authentication failure maps to, so provider ids can't be probed (research.md §8). */
export const AUTH_FAILURE_MESSAGE = "invalid or revoked token for this agent address";

/** Optional brute-force guard (FR-035); implemented in auth-throttle.ts. */
export interface AuthThrottle {
  isBlocked(source: string, providerId: string): Promise<boolean>;
  recordFailure(source: string, providerId: string): Promise<void>;
}

export interface GrpcAgentServerDeps {
  config: Config;
  store: ProviderStore;
  publisher: SnapshotSource;
  registry: SessionRegistry;
  throttle?: AuthThrottle;
  serverVersion?: string;
}

const STATUS: Record<CloseReason["code"], grpc.status> = {
  ok: grpc.status.OK,
  unauthenticated: grpc.status.UNAUTHENTICATED,
  failed_precondition: grpc.status.FAILED_PRECONDITION,
  aborted: grpc.status.ABORTED,
  unavailable: grpc.status.UNAVAILABLE,
  deadline_exceeded: grpc.status.DEADLINE_EXCEEDED,
  internal: grpc.status.INTERNAL,
};

function protoPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/adapters/agent-grpc and dist/adapters/agent-grpc are the same depth below backend/, which sits next to proto/.
  const candidates = [resolve(here, "../../../../proto/fluxip/agent/v1/session.proto"), resolve(process.cwd(), "proto/fluxip/agent/v1/session.proto")];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`session.proto not found (looked in ${candidates.join(", ")})`);
  return found;
}

type SessionCall = grpc.ServerDuplexStream<WireEnvelope, Record<string, unknown>>;

/** Variant A adapter: the agent dials in; each stream becomes an {@link AgentChannel} for the shared session handler. */
export class GrpcAgentServer {
  private server: grpc.Server | null = null;

  constructor(private readonly deps: GrpcAgentServerDeps) {}

  async start(port = this.deps.config.agentPort, host = "0.0.0.0"): Promise<number> {
    const definition = protoLoader.loadSync(protoPath(), {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(definition) as unknown as {
      fluxip: { agent: { v1: { AgentSession: { service: grpc.ServiceDefinition } } } };
    };

    const limit = this.deps.config.agentSnapshotMaxBytes + 64 * 1024;
    const server = new grpc.Server({
      "grpc.max_receive_message_length": limit,
      "grpc.max_send_message_length": limit,
      "grpc.keepalive_time_ms": 30_000,
      "grpc.keepalive_timeout_ms": 10_000,
      "grpc.keepalive_permit_without_calls": 1,
      "grpc.http2.min_ping_interval_without_data_ms": 10_000,
    });
    server.addService(pkg.fluxip.agent.v1.AgentSession.service, {
      session: (call: SessionCall) => {
        void this.onSession(call).catch((err: unknown) => {
          logger.error("Unhandled error in agent session: {error}", { error: err instanceof Error ? err.message : String(err) });
          this.fail(call, grpc.status.INTERNAL, "internal error");
        });
      },
    } as unknown as grpc.UntypedServiceImplementation);
    this.server = server;

    return new Promise((resolvePort, reject) => {
      server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (err, bound) => {
        if (err) return reject(err);
        logger.info("Agent session listener on port {port}", { port: bound });
        resolvePort(bound);
      });
    });
  }

  /** Ends all sessions with UNAVAILABLE, then closes the listener. */
  async stop(): Promise<void> {
    this.deps.registry.terminateAll({ code: "unavailable", message: "server shutting down", disconnect: "closed" });
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        server.forceShutdown();
        done();
      }, 2000);
      server.tryShutdown(() => {
        clearTimeout(timer);
        done();
      });
    });
  }

  private fail(call: SessionCall, code: grpc.status, details: string): void {
    call.emit("error", { code, details });
  }

  private sourceOf(call: SessionCall): string {
    const forwarded = call.metadata.get("x-forwarded-for")[0];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
      return parts[parts.length - 1] ?? call.getPeer();
    }
    return call.getPeer();
  }

  private async authenticate(
    call: SessionCall,
  ): Promise<{ accountId: string; providerId: string; tokenId: string } | "throttled" | null> {
    const providerId = String(call.metadata.get("x-fluxip-provider")[0] ?? "").trim();
    const header = String(call.metadata.get("authorization")[0] ?? "");
    const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    const source = this.sourceOf(call);
    const { throttle, store } = this.deps;

    if (throttle && (await throttle.isBlocked(source, providerId))) return "throttled";

    const reject = async (): Promise<null> => {
      if (throttle) await throttle.recordFailure(source, providerId);
      return null;
    };
    if (!providerId || !presented) return reject();

    const accountId = await store.resolveAccountId(providerId);
    if (!accountId) return reject();
    const loaded = await store.loadActive(accountId, providerId);
    if (!loaded) return reject();
    const token = activeTokens(loaded.state).find((t) => verifyAgentToken(presented, t.hash));
    if (!token) return reject();
    return { accountId, providerId, tokenId: token.tokenId };
  }

  private async onSession(call: SessionCall): Promise<void> {
    const auth = await this.authenticate(call);
    if (auth === "throttled") {
      this.fail(call, grpc.status.RESOURCE_EXHAUSTED, "too many failed attempts, retry later");
      return;
    }
    if (!auth) {
      this.fail(call, grpc.status.UNAUTHENTICATED, AUTH_FAILURE_MESSAGE);
      return;
    }

    const sessionId = AgentSessionHandler.newSessionId();
    let handler: AgentSessionHandler | null = null;
    let ended = false;

    const channel: AgentChannel = {
      sessionId,
      tokenId: auth.tokenId,
      send: (message: AgentMessage) => {
        if (ended) return;
        try {
          call.write(encodeEnvelope(message));
        } catch (err) {
          logger.warning("Write to session {sessionId} failed: {error}", {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      close: (reason: CloseReason) => {
        if (ended) return;
        ended = true;
        if (reason.code === "ok") call.end();
        else this.fail(call, STATUS[reason.code], reason.message);
        void handler?.onClosed(reason);
      },
    };

    handler = new AgentSessionHandler({
      providerId: auth.providerId,
      accountId: auth.accountId,
      channel,
      store: this.deps.store,
      publisher: this.deps.publisher,
      registry: this.deps.registry,
      config: this.deps.config,
      serverVersion: this.deps.serverVersion,
    });

    const finish = (): void => {
      ended = true;
      void handler?.onClosed();
    };
    call.on("data", (envelope: WireEnvelope) => {
      const message = decodeEnvelope(envelope);
      if (!message) {
        logger.debug("Ignoring unknown or malformed message on session {sessionId}", { sessionId });
        return;
      }
      void handler?.handle(message);
    });
    call.on("end", () => {
      if (!ended) {
        ended = true;
        call.end();
      }
      void handler?.onClosed();
    });
    call.on("cancelled", finish);
    call.on("close", finish);
    call.on("error", (err: Error) => {
      logger.debug("Session {sessionId} stream error: {error}", { sessionId, error: err.message });
      finish();
    });
  }
}
