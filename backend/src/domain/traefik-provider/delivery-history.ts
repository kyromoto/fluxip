import type { StoredEvent } from "../../ports/event-store.js";
import {
  TraefikProviderEventName,
  type TraefikProviderSnapshotApplyFailedData,
  type TraefikProviderSnapshotAppliedData,
  type TraefikProviderSnapshotPublishFailedData,
  type TraefikProviderSnapshotPublishedData,
} from "./events.js";

/** "delivered": the snapshot's own cause. "combined": the change went into a snapshot caused by a later one. */
export type DeliveryKind = "delivered" | "combined";
export type DeliveryStage = "published" | "applied" | "failed";

/** What a device's IP change led to for one Traefik delivery action (data-model.md). Derived, never stored. */
export interface TraefikDelivery {
  actionId: string;
  traefikProviderId: string;
  /** null when the provider no longer exists. */
  providerName: string | null;
  group: string;
  kind: DeliveryKind;
  stage: DeliveryStage | null;
  at: string | null;
  error: string | null;
  version: number | null;
}

export interface DeliveryActionRef {
  actionId: string;
  traefikProviderId: string;
  group: string;
}

export interface DeliveryProvider {
  name: string | null;
  events: StoredEvent[];
}

/**
 * Derives, per IP change, the delivery rows of a device's Traefik actions from the provider event streams
 * (research.md §2–§4). A change has a row only when a provider event names it: as the snapshot's
 * correlation id, or among the changes that snapshot absorbed.
 */
export function deriveDeliveries(params: {
  ipChangedEventIds: string[];
  actions: DeliveryActionRef[];
  providers: Map<string, DeliveryProvider>;
}): Map<string, TraefikDelivery[]> {
  const result = new Map<string, TraefikDelivery[]>(params.ipChangedEventIds.map((id) => [id, []]));

  for (const action of params.actions) {
    const provider = params.providers.get(action.traefikProviderId);
    if (!provider) continue;
    const events = [...provider.events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const applied = events.filter((e) => e.eventName === TraefikProviderEventName.SnapshotApplied);
    const applyFailed = events.filter((e) => e.eventName === TraefikProviderEventName.SnapshotApplyFailed);

    // Later events win; "delivered" beats "combined" for the same change.
    const rows = new Map<string, TraefikDelivery>();
    const put = (changeId: string, row: TraefikDelivery) => {
      if (!result.has(changeId)) return;
      const existing = rows.get(changeId);
      if (existing?.kind === "delivered" && row.kind === "combined") return;
      rows.set(changeId, row);
    };
    const base = {
      actionId: action.actionId,
      traefikProviderId: action.traefikProviderId,
      providerName: provider.name,
      group: action.group,
    };

    for (const event of events) {
      if (event.eventName === TraefikProviderEventName.SnapshotPublished) {
        const data = event.data as TraefikProviderSnapshotPublishedData;
        const version = event.sequenceNumber;
        const done = applied.find((a) => (a.data as TraefikProviderSnapshotAppliedData).version >= version);
        const failed = applyFailed.filter((f) => (f.data as TraefikProviderSnapshotApplyFailedData).version === version).at(-1);
        const stage: Pick<TraefikDelivery, "stage" | "at" | "error"> = done
          ? { stage: "applied", at: (done.data as TraefikProviderSnapshotAppliedData).appliedAt, error: null }
          : failed
            ? {
                stage: "failed",
                at: (failed.data as TraefikProviderSnapshotApplyFailedData).appliedAt,
                error: (failed.data as TraefikProviderSnapshotApplyFailedData).reason,
              }
            : { stage: "published", at: data.publishedAt, error: null };
        put(data.correlationId, { ...base, kind: "delivered", ...stage, version });
        for (const id of data.absorbedCausationIds ?? []) {
          put(id, { ...base, kind: "combined", stage: null, at: null, error: null, version });
        }
      } else if (event.eventName === TraefikProviderEventName.SnapshotPublishFailed) {
        const data = event.data as TraefikProviderSnapshotPublishFailedData;
        put(data.correlationId, {
          ...base,
          kind: "delivered",
          stage: "failed",
          at: data.failedAt,
          error: data.reason,
          version: null,
        });
        for (const id of data.absorbedCausationIds ?? []) {
          put(id, { ...base, kind: "combined", stage: null, at: null, error: null, version: null });
        }
      }
    }

    for (const [changeId, row] of rows) result.get(changeId)!.push(row);
  }

  return result;
}
