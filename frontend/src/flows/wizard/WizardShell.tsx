import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { Progress, ProgressLabel, ProgressValueLabel } from "~/components/ui/progress";
import type { UseWizardReturn } from "./useWizard";

interface WizardShellProps<TData extends object> {
  wizard: UseWizardReturn<TData>;
  /** Always available (contracts/wizard-shell.md invariant 5) — unmounts without calling onComplete. */
  onCancel: () => void;
  confirmLabel?: string;
}

/**
 * The one shared implementation backing all three guided flows
 * (contracts/wizard-shell.md). Always shows step progress (FR-008), never
 * discards data on back-navigation (FR-009 — enforced by useWizard), and
 * only ever submits from the final step (FR-010 — enforced by useWizard).
 */
export function WizardShell<TData extends object>(props: WizardShellProps<TData>) {
  return (
    <Card class="mx-auto w-full max-w-lg">
      <CardHeader class="gap-3">
        <Progress
          value={props.wizard.currentStepIndex() + 1}
          minValue={0}
          maxValue={props.wizard.totalSteps()}
          getValueLabel={() => `Step ${props.wizard.currentStepIndex() + 1} of ${props.wizard.totalSteps()}`}
        >
          <div class="flex items-center justify-between">
            <ProgressLabel>{props.wizard.currentStep().title}</ProgressLabel>
            <ProgressValueLabel />
          </div>
        </Progress>
        <CardTitle class="sr-only">{props.wizard.currentStep().title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Dynamic
          component={props.wizard.currentStep().component}
          data={props.wizard.data()}
          updateData={props.wizard.updateStepData}
        />
      </CardContent>
      <CardFooter class="flex justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <div class="flex gap-2">
          <Show when={props.wizard.canGoBack()}>
            <Button type="button" variant="outline" onClick={() => props.wizard.goBack()}>
              Back
            </Button>
          </Show>
          <Show
            when={props.wizard.isLastStep()}
            fallback={
              <Button
                type="button"
                disabled={!props.wizard.canGoNext()}
                onClick={() => props.wizard.goNext()}
              >
                Next
              </Button>
            }
          >
            <Button
              type="button"
              disabled={!props.wizard.canGoNext() || props.wizard.isSubmitting()}
              onClick={() => void props.wizard.submit()}
            >
              {props.wizard.isSubmitting() ? "Saving…" : (props.confirmLabel ?? "Finish")}
            </Button>
          </Show>
        </div>
      </CardFooter>
    </Card>
  );
}
