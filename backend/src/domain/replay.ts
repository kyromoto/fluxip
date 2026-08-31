import { Counter, Histogram } from "prom-client";
import type { EventStore, StoredEvent } from "../ports/event-store.js";

// Both metrics live here (not under adapters/) so domain/ never has to import
// adapters/ to record them — prom-client's default registry is the shared glue;
// adapters/http/metrics-route.ts exposes that same registry over HTTP.
const replayDurationSeconds = new Histogram({
  name: "fluxip_replay_duration_seconds",
  help: "Duration of aggregate replays in seconds, per aggregate",
  labelNames: ["aggregate_type", "aggregate_id"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

const replayEventsTotal = new Counter({
  name: "fluxip_replay_events_total",
  help: "Total number of events read during aggregate replays, per aggregate",
  labelNames: ["aggregate_type", "aggregate_id"] as const,
});

export interface LoadAggregateParams {
  accountId: string;
  aggregateType: string;
  aggregateId: string;
}

export interface LoadAggregateResult<TState, TData> {
  state: TState;
  events: StoredEvent<TData>[];
  /** Current stream length == the sequence_number the next appended event must use. */
  version: number;
}

export async function loadAggregate<TState, TData = unknown>(
  eventStore: EventStore,
  params: LoadAggregateParams,
  initialState: TState,
  reducer: (state: TState, event: StoredEvent<TData>) => TState,
): Promise<LoadAggregateResult<TState, TData>> {
  const labels = { aggregate_type: params.aggregateType, aggregate_id: params.aggregateId };
  const stopTimer = replayDurationSeconds.startTimer(labels);
  const events = await eventStore.readStream<TData>(params);
  stopTimer();
  replayEventsTotal.inc(labels, events.length);

  const state = events.reduce(reducer, initialState);
  return { state, events, version: events.length };
}
