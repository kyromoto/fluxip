import { Hono } from "hono";
import { ulid } from "ulid";
import type { Config } from "../../../config/env.js";
import { buildDomainEvent } from "../../../domain/cloud-events.js";
import { loadAggregate } from "../../../domain/replay.js";
import { actionReducer, initialActionState } from "../../../domain/action/action-aggregate.js";
import { ACTION_AGGREGATE_TYPE } from "../../../domain/action/events.js";
import {
  PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
  ProviderCredentialEventName,
  type ProviderCredentialRevokedData,
  type ProviderCredentialStoredData,
} from "../../../domain/provider-credential/events.js";
import {
  initialProviderCredentialState,
  providerCredentialReducer,
  type ProviderCredentialState,
} from "../../../domain/provider-credential/provider-credential-aggregate.js";
import { encryptSecret, maskLast4 } from "../../../domain/provider-credential/secret-encryption.js";
import type { EventStore } from "../../../ports/event-store.js";
import { getAuth } from "../../auth-logto/oidc-middleware.js";

export interface ProviderCredentialsRouteDeps {
  config: Config;
  eventStore: EventStore;
}

/** Every active credential entry for an account, via aggregate replay (research.md §4/§8 — small scale, no projection). */
async function listActiveCredentials(deps: ProviderCredentialsRouteDeps, accountId: string): Promise<ProviderCredentialState[]> {
  const ids = await deps.eventStore.listAggregateIds({
    accountId,
    aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
  });

  const states: ProviderCredentialState[] = [];
  for (const id of ids) {
    const { state } = await loadAggregate(
      deps.eventStore,
      { accountId, aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE, aggregateId: id },
      initialProviderCredentialState,
      providerCredentialReducer,
    );
    if (state.status === "active") states.push(state);
  }
  return states;
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

    const existing = await listActiveCredentials(deps, auth.accountId);
    const normalizedLabel = body.label.trim().toLowerCase();
    if (existing.some((state) => state.label.trim().toLowerCase() === normalizedLabel)) {
      return c.json({ error: "label already in use" }, 409);
    }

    const credentialId = ulid();
    const data: ProviderCredentialStoredData = {
      credentialId,
      accountId: auth.accountId,
      provider: body.provider,
      label: body.label,
      encryptedSecret: encryptSecret(body.secret, deps.config.credentialEncryptionKey),
      secretLast4: maskLast4(body.secret),
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
      accountId: auth.accountId,
      expectedSequenceNumber: 1,
      eventName: ProviderCredentialEventName.Stored,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    return c.json({ credentialId, provider: body.provider, label: body.label, secretLast4: data.secretLast4 }, 201);
  });

  router.get("/", async (c) => {
    const auth = getAuth(c);
    const states = await listActiveCredentials(deps, auth.accountId);
    const items = states.map((state) => ({
      credentialId: state.credentialId,
      provider: state.provider,
      label: state.label,
      secretLast4: state.secretLast4,
    }));
    return c.json({ items });
  });

  router.delete("/:id", async (c) => {
    const auth = getAuth(c);
    const credentialId = c.req.param("id");

    const { state, version } = await loadAggregate(
      deps.eventStore,
      { accountId: auth.accountId, aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE, aggregateId: credentialId },
      initialProviderCredentialState,
      providerCredentialReducer,
    );
    if (!state.credentialId || state.accountId !== auth.accountId || state.status !== "active") {
      return c.json({ error: "not found" }, 404);
    }

    const actionIds = await deps.eventStore.listAggregateIds({
      accountId: auth.accountId,
      aggregateType: ACTION_AGGREGATE_TYPE,
    });
    const usedBy: { actionId: string; ipClientId: string; zone: string; recordName: string }[] = [];
    for (const actionId of actionIds) {
      const { state: actionState } = await loadAggregate(
        deps.eventStore,
        { accountId: auth.accountId, aggregateType: ACTION_AGGREGATE_TYPE, aggregateId: actionId },
        initialActionState,
        actionReducer,
      );
      if (
        actionState.status !== "detached" &&
        actionState.config?.providerCredentialId === credentialId &&
        actionState.actionId &&
        actionState.ipClientId
      ) {
        usedBy.push({
          actionId: actionState.actionId,
          ipClientId: actionState.ipClientId,
          zone: actionState.config.zone,
          recordName: actionState.config.recordName,
        });
      }
    }
    if (usedBy.length > 0) {
      return c.json({ error: "credential_in_use", usedBy }, 409);
    }

    const data: ProviderCredentialRevokedData = { revokedAt: new Date().toISOString() };
    const built = buildDomainEvent(deps.config, PROVIDER_CREDENTIAL_AGGREGATE_TYPE, ProviderCredentialEventName.Revoked, data);
    await deps.eventStore.append({
      id: built.id,
      aggregateType: PROVIDER_CREDENTIAL_AGGREGATE_TYPE,
      aggregateId: credentialId,
      accountId: auth.accountId,
      expectedSequenceNumber: version + 1,
      eventName: ProviderCredentialEventName.Revoked,
      type: built.type,
      source: built.source,
      time: built.time,
      data: built.data,
    });

    return c.body(null, 204);
  });

  return router;
}
