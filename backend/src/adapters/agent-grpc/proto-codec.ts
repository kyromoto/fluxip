import type { AgentMessage } from "../../domain/traefik-provider/agent-protocol.js";
import type { TraefikCheckResult } from "../../domain/traefik-provider/events.js";

/** Shape of an Envelope as produced by @grpc/proto-loader (`oneofs: true`, `longs: Number`, `enums: String`). */
export interface WireEnvelope {
  body?: string;
  hello?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  report?: Record<string, unknown>;
  heartbeat?: Record<string, unknown>;
  syncRequest?: Record<string, unknown>;
  bye?: Record<string, unknown>;
}

const MAX_TEXT = 2000;
const MAX_FILES = 500;

function str(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function sums(value: unknown): { name: string; sha256: string }[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FILES).map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return { name: str(o.name, 256), sha256: str(o.sha256, 64) };
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, MAX_FILES).map((v) => str(v, 256)) : [];
}

function checkFrom(value: unknown): TraefikCheckResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const status = o.status === "STATUS_OK" ? "ok" : o.status === "STATUS_MISSING" ? "missing" : o.status === "STATUS_UNREACHABLE" ? "unreachable" : null;
  if (!status) return undefined;
  return { status, loaded: strings(o.loaded), missing: strings(o.missing) };
}

/** Wire → domain. Unknown or malformed messages yield null; the caller logs and ignores them. */
export function decodeEnvelope(envelope: WireEnvelope): AgentMessage | null {
  switch (envelope.body) {
    case "hello": {
      const h = envelope.hello ?? {};
      return {
        type: "hello",
        protocolVersion: num(h.protocolVersion),
        agentVersion: str(h.agentVersion, 64),
        maxOfflineSeconds: num(h.maxOfflineSeconds),
        heartbeatSeconds: num(h.heartbeatSeconds),
        maxSnapshotBytes: num(h.maxSnapshotBytes),
        providerName: str(h.providerName, 256),
        acceptedVersion: num(h.acceptedVersion),
      };
    }
    case "report": {
      const r = envelope.report ?? {};
      const result = r.result === "RESULT_OK" ? "ok" : r.result === "RESULT_ERROR" ? "error" : r.result === "RESULT_IGNORED_STALE" ? "ignored_stale" : null;
      if (!result) return null;
      return {
        type: "report",
        version: num(r.version),
        correlationId: str(r.correlationId, 128),
        result,
        error: str(r.error),
        agentVersion: str(r.agentVersion, 64),
        stale: r.stale === true,
        files: sums(r.files),
        templates: sums(r.templates),
        traefikCheck: checkFrom(r.traefikCheck),
      };
    }
    case "heartbeat":
      return { type: "heartbeat", nonce: num(envelope.heartbeat?.nonce) };
    case "syncRequest":
      return { type: "syncRequest" };
    case "bye":
      return { type: "bye", reason: str(envelope.bye?.reason, 256) };
    default:
      return null;
  }
}

/** Domain → wire. */
export function encodeEnvelope(message: AgentMessage): Record<string, unknown> {
  switch (message.type) {
    case "hello":
      return {
        hello: {
          protocolVersion: message.protocolVersion,
          agentVersion: message.agentVersion,
          maxOfflineSeconds: message.maxOfflineSeconds,
          heartbeatSeconds: message.heartbeatSeconds,
          maxSnapshotBytes: message.maxSnapshotBytes,
          providerName: message.providerName,
          acceptedVersion: message.acceptedVersion,
        },
      };
    case "snapshot":
      return {
        snapshot: {
          version: message.version,
          correlationId: message.correlationId,
          generatedAt: message.generatedAt,
          providerName: message.providerName,
          groups: message.groups.map((g) => ({
            key: g.key,
            entries: g.entries.map((e) => ({ deviceName: e.deviceName, ips: e.ips })),
          })),
        },
      };
    case "heartbeat":
      return { heartbeat: { nonce: message.nonce } };
    case "syncRequest":
      return { syncRequest: {} };
    case "bye":
      return { bye: { reason: message.reason } };
    case "report":
      throw new Error("the server never sends reports");
  }
}
