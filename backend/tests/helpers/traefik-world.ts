import { ulid } from "ulid";
import type { Config } from "../../src/config/env.js";
import { scheduleDebounce } from "../../src/adapters/queue-bullmq/debounce-scheduler.js";
import type { Queue } from "bullmq";
import { ACTION_AGGREGATE_TYPE, ActionEventName, TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE } from "../../src/domain/action/events.js";
import { generateCredential } from "../../src/domain/ip-client/credential.js";
import { IP_CLIENT_AGGREGATE_TYPE, IpClientEventName } from "../../src/domain/ip-client/events.js";
import { TraefikProviderEventName as E } from "../../src/domain/traefik-provider/events.js";
import type { ProviderStore } from "../../src/domain/traefik-provider/provider-store.js";
import { generateAgentToken } from "../../src/domain/traefik-provider/token.js";
import type { EventStore } from "../../src/ports/event-store.js";

/** Builders for integration tests: write the same events the HTTP routes would, without going through HTTP. */
export class TraefikWorld {
  constructor(
    readonly config: Config,
    readonly eventStore: EventStore,
    readonly store: ProviderStore,
  ) {}

  private async raw(accountId: string, aggregateType: string, aggregateId: string, eventName: string, data: unknown): Promise<void> {
    const events = await this.eventStore.readStream({ accountId, aggregateType, aggregateId });
    await this.eventStore.append({
      id: ulid(),
      aggregateType,
      aggregateId,
      accountId,
      expectedSequenceNumber: events.length + 1,
      eventName,
      type: "t",
      source: "s",
      time: new Date().toISOString(),
      data,
    });
  }

  async provider(accountId: string, name: string): Promise<{ providerId: string; token: string }> {
    const providerId = ulid();
    await this.store.append(accountId, providerId, E.Created, { providerId, accountId, name, connectionMode: "agent_initiated", createdAt: new Date().toISOString() });
    const token = generateAgentToken();
    await this.store.append(accountId, providerId, E.TokenIssued, { tokenId: ulid(), tokenHash: token.hash, last4: token.last4, issuedAt: new Date().toISOString() });
    return { providerId, token: token.plaintext };
  }

  async device(accountId: string, label: string): Promise<string> {
    const ipClientId = ulid();
    await this.raw(accountId, IP_CLIENT_AGGREGATE_TYPE, ipClientId, IpClientEventName.Registered, {
      ipClientId,
      accountId,
      label,
      credentialHash: generateCredential().hash,
      registeredAt: new Date().toISOString(),
    });
    return ipClientId;
  }

  async deliveryAction(accountId: string, ipClientId: string, providerId: string, group: string): Promise<string> {
    const actionId = ulid();
    await this.raw(accountId, ACTION_AGGREGATE_TYPE, actionId, ActionEventName.Attached, {
      actionId,
      accountId,
      ipClientId,
      type: TRAEFIK_CONFIG_DELIVERY_ACTION_TYPE,
      addressFamilies: ["ipv4", "ipv6"],
      config: { traefikProviderId: providerId, group },
      attachedAt: new Date().toISOString(),
    });
    return actionId;
  }

  /** What the trigger endpoint does: record the report and (re)start the debounce window. */
  async reportIp(debounceQueue: Queue, accountId: string, ipClientId: string, ip: string): Promise<void> {
    await this.raw(accountId, IP_CLIENT_AGGREGATE_TYPE, ipClientId, IpClientEventName.IpReportReceived, { reportedIPv4: ip, receivedAt: new Date().toISOString() });
    await scheduleDebounce(debounceQueue, this.config, ipClientId, accountId);
  }

  async ipChangedEvents(accountId: string, ipClientId: string) {
    const events = await this.eventStore.readStream({ accountId, aggregateType: IP_CLIENT_AGGREGATE_TYPE, aggregateId: ipClientId });
    return events.filter((e) => e.eventName === IpClientEventName.IpChanged);
  }
}

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 8000, stepMs = 25): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error("waitFor timed out");
}
