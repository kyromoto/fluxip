import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const here = dirname(fileURLToPath(import.meta.url));
const definition = protoLoader.loadSync(resolve(here, "../../../proto/fluxip/agent/v1/session.proto"), {
  keepCase: false,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
});
const pkg = grpc.loadPackageDefinition(definition) as unknown as {
  fluxip: { agent: { v1: { AgentSession: new (address: string, creds: grpc.ChannelCredentials) => grpc.Client } } };
};

export interface Wire {
  body?: string;
  [key: string]: unknown;
}

/** A plain gRPC test client speaking the raw wire protocol, standing in for the Go agent. */
export class TestAgent {
  readonly received: Wire[] = [];
  error: grpc.ServiceError | null = null;
  ended = false;
  private readonly client: grpc.Client;
  private readonly stream: grpc.ClientDuplexStream<Wire, Wire>;
  private waiters: (() => void)[] = [];

  constructor(port: number, opts: { providerId: string; token?: string; extra?: Record<string, string> }) {
    this.client = new pkg.fluxip.agent.v1.AgentSession(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    const metadata = new grpc.Metadata();
    if (opts.token) metadata.set("authorization", `Bearer ${opts.token}`);
    metadata.set("x-fluxip-provider", opts.providerId);
    for (const [k, v] of Object.entries(opts.extra ?? {})) metadata.set(k, v);
    this.stream = (this.client as unknown as { session(m: grpc.Metadata): grpc.ClientDuplexStream<Wire, Wire> }).session(metadata);
    this.stream.on("data", (message: Wire) => {
      this.received.push(message);
      this.wake();
    });
    this.stream.on("error", (err: grpc.ServiceError) => {
      this.error = err;
      this.wake();
    });
    this.stream.on("end", () => {
      this.ended = true;
      this.wake();
    });
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  send(message: Wire): void {
    this.stream.write(message);
  }

  hello(overrides: Record<string, unknown> = {}): void {
    this.send({ hello: { protocolVersion: 1, agentVersion: "test-1.0.0", maxOfflineSeconds: 86400, ...overrides } });
  }

  async waitUntil(check: () => boolean, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out; received ${JSON.stringify(this.received.map((m) => m.body))} error=${this.error?.message}`);
      await new Promise<void>((resolveWait) => {
        this.waiters.push(resolveWait);
        setTimeout(resolveWait, 50);
      });
    }
  }

  messages(body: string): Wire[] {
    return this.received.filter((m) => m.body === body);
  }

  async waitForMessage(body: string, timeoutMs?: number): Promise<Wire> {
    await this.waitUntil(() => this.messages(body).length > 0, timeoutMs);
    return this.messages(body)[0] as Wire;
  }

  async waitForError(timeoutMs?: number): Promise<grpc.ServiceError> {
    await this.waitUntil(() => this.error !== null || this.ended, timeoutMs);
    if (!this.error) throw new Error("stream ended without an error");
    return this.error;
  }

  close(): void {
    this.stream.cancel();
    this.client.close();
  }
}
