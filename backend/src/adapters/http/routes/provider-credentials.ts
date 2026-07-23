import { Hono } from "hono";
import { ulid } from "ulid";
import type { Config } from "../../../config/env.js";
import { buildDomainEvent } from "../../../domain/cloud-events.js";
import { loadAggregate } from "../../../domain/replay.js";
import {
  PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
  ProviderCredentialEventName,
  type ProviderCredentialStoredData,
} from "../../../domain/provider-credential/events.js";
import {
  initialProviderCredentialState,
  providerCredentialReducer,
} from "../../../domain/provider-credential/provider-credential-aggregate.js";
import { encryptSecret } from "../../../domain/provider-credential/secret-encryption.js";
import type { EventStore } from "../../../ports/event-store.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface ProviderCredentialsRouteDeps {
  config: Config;
  eventStore: EventStore;
}

export function createProviderCredentialsRoutes(deps: ProviderCredentialsRouteDeps): Hono {
  const router = new Hono();

  router.post("/", async (c) => {
    const auth = getAuth(c);
    const body = await c.req.json<{ provider?: string; label?: string; secret?: string }>().catch(
      () => ({}) as Record<string, never>,
    );

    if (!body.provider || !body.label || !body.secret) {
      return c.json({ error: "provider, label, and secret are required" }, 400);
    }

    const credentialId = ulid();
    const data: ProviderCredentialStoredData = {
      credentialId,
      accountId: auth.tenantId,
      provider: body.provider,
      label: body.label,
      encryptedSecret: encryptSecret(body.secret, deps.config.credentialEncryptionKey),
      storedAt: new Date().toISOString(),
    };
    const built = buildDomainEvent(
      deps.config,
      PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      ProviderCredentialEventName.Stored,
      data,
    );

    await deps.eventStore.append({
      id: built.id,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: credentialId,
      tenantId: auth.tenantId,
      expectedSequenceNumber: 1,
      eventName: ProviderCredentialEventName.Stored,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    return c.json({ credentialId, provider: body.provider, label: body.label }, 201);
  });

  router.get("/", async (c) => {
    const auth = getAuth(c);
    const ids = await deps.eventStore.listAggregateIds({
      tenantId: auth.tenantId,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
    });

    const items = [];
    for (const id of ids) {
      const { state } = await loadAggregate(
        deps.eventStore,
        { tenantId: auth.tenantId, aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE, aggregateId: id },
        initialProviderCredentialState,
        providerCredentialReducer,
      );
      if (state.status === "active") {
        items.push({ credentialId: state.credentialId, provider: state.provider, label: state.label });
      }
    }
    return c.json({ items });
  });

  return router;
}
