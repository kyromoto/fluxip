import { Match, Switch, type Component } from "solid-js";

export type ExecutionStatus = "running" | "succeeded" | "failed";

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, string> = {
  running: "In progress",
  succeeded: "Succeeded",
  failed: "Failed",
};

const BASE = "h-4 w-4 shrink-0";

/**
 * Status of one action execution as a colored icon: green check = succeeded, red cross = failed, amber
 * clock = still running. The wording is available on hover (title) and to screen readers (aria-label),
 * so nothing is lost by dropping the visible text.
 */
export const ExecutionStatusIcon: Component<{ status: ExecutionStatus }> = (props) => {
  const label = () => EXECUTION_STATUS_LABEL[props.status];
  return (
    <span class="inline-flex" role="img" aria-label={label()} title={label()} data-status={props.status}>
      <Switch>
        <Match when={props.status === "succeeded"}>
          <svg class={`${BASE} text-green-600 dark:text-green-400`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="m8 12.5 2.8 2.8L16 9.5" />
          </svg>
        </Match>
        <Match when={props.status === "failed"}>
          <svg class={`${BASE} text-destructive`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6M9 9l6 6" />
          </svg>
        </Match>
        <Match when={props.status === "running"}>
          <svg class={`${BASE} text-amber-600 dark:text-amber-400`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 7v5l3 2" />
          </svg>
        </Match>
      </Switch>
    </span>
  );
};
