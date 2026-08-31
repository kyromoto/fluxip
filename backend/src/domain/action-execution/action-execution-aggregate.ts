import type { StoredEvent } from "../../ports/event-store.js";
import {
  ActionExecutionEventName,
  type ActionExecutionFailedData,
  type ActionExecutionStartedData,
  type ActionExecutionSucceededData,
  type IpValuesUsed,
  type TriggeredBy,
} from "./events.js";

export interface ActionExecutionState {
  executionId: string | null;
  accountId: string | null;
  actionId: string | null;
  ipClientId: string | null;
  triggeredBy: TriggeredBy | null;
  causationEventId: string | null;
  ipValuesUsed: IpValuesUsed;
  attempt: number;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

export const initialActionExecutionState: ActionExecutionState = {
  executionId: null,
  accountId: null,
  actionId: null,
  ipClientId: null,
  triggeredBy: null,
  causationEventId: null,
  ipValuesUsed: {},
  attempt: 0,
  status: "running",
  error: null,
  startedAt: null,
  completedAt: null,
  failedAt: null,
};

export function actionExecutionReducer(
  state: ActionExecutionState,
  event: StoredEvent,
): ActionExecutionState {
  switch (event.eventName) {
    case ActionExecutionEventName.Started: {
      const data = event.data as ActionExecutionStartedData;
      return {
        ...state,
        executionId: data.executionId,
        accountId: data.accountId,
        actionId: data.actionId,
        ipClientId: data.ipClientId,
        triggeredBy: data.triggeredBy,
        causationEventId: data.causationEventId,
        ipValuesUsed: data.ipValuesUsed,
        attempt: data.attempt,
        status: "running",
        startedAt: data.startedAt,
      };
    }
    case ActionExecutionEventName.Succeeded: {
      const data = event.data as ActionExecutionSucceededData;
      return { ...state, status: "succeeded", error: null, completedAt: data.completedAt };
    }
    case ActionExecutionEventName.Failed: {
      const data = event.data as ActionExecutionFailedData;
      return { ...state, status: "failed", attempt: data.attempt, error: data.error, failedAt: data.failedAt };
    }
    default:
      return state;
  }
}
