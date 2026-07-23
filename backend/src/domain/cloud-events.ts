import { CloudEvent } from "cloudevents";
import { ulid } from "ulid";
import type { Config } from "../config/env.js";

export interface BuiltEvent<TData> {
  id: string;
  type: string;
  source: string;
  time: string;
  data: TData;
}

/**
 * Builds a CloudEvents-compliant envelope for one domain event.
 * `type` is assembled as `${CLOUDEVENTS_TYPE_PREFIX}.<aggregateType>.<eventName>`
 * per research.md §3 — source and prefix are always read from config, never hardcoded.
 */
export function buildDomainEvent<TData>(
  config: Config,
  aggregateType: string,
  eventName: string,
  data: TData,
): BuiltEvent<TData> {
  const ce = new CloudEvent<TData>({
    id: ulid(),
    source: config.cloudEventsSource,
    type: `${config.cloudEventsTypePrefix}.${aggregateType}.${eventName}`,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data,
  });

  return {
    id: ce.id,
    type: ce.type,
    source: ce.source,
    time: ce.time ?? new Date().toISOString(),
    data: ce.data as TData,
  };
}
