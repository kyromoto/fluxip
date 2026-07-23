import type { Component } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription } from "~/components/ui/card";

interface EmptyStateProps {
  /** Plain-language explanation that the list is empty (FR-013) — never blank. */
  message: string;
  /** Call-to-action button text. */
  actionLabel: string;
  /** Starts the relevant guided flow — never a no-op (FR-019). */
  onAction: () => void;
}

/**
 * Renders instead of a bare empty list/table whenever a list screen's data
 * resolves to zero items (FR-019; contracts/empty-state.md). Never used for
 * the "still loading" state — that stays a separate fallback.
 */
export const EmptyState: Component<EmptyStateProps> = (props) => {
  return (
    <Card class="border-dashed">
      <CardContent class="flex flex-col items-center gap-4 py-10 text-center">
        <CardDescription class="text-base">{props.message}</CardDescription>
        <Button onClick={() => props.onAction()}>{props.actionLabel}</Button>
      </CardContent>
    </Card>
  );
};
