# UI Contract: WizardShell / useWizard

Governs the one shared implementation used by all three guided flows (FR-005/006/007). Any flow-specific wizard (onboarding, device creation, action configuration) is a *consumer* of this contract, not a reimplementation of it.

## `useWizard(definition: WizardDefinition)`

Returns:

```ts
{
  currentStep: () => WizardStepDefinition;
  currentStepIndex: () => number;
  totalSteps: () => number;
  canGoNext: () => boolean;   // definition.steps[currentStepIndex].isValid(data)
  canGoBack: () => boolean;   // currentStepIndex > 0
  data: () => StepDataBag;
  updateStepData: (patch: Partial<StepDataBag>) => void;
  goNext: () => void;         // no-op if !canGoNext()
  goBack: () => void;         // no-op if !canGoBack(); NEVER clears data
  submit: () => Promise<void>; // only callable on the last step; calls definition.onComplete(data) exactly once
}
```

## Invariants

1. **Progress visibility (FR-008)**: `WizardShell` always renders `currentStepIndex`/`totalSteps` (or an equivalent completion fraction) and the current step's `title`. A flow cannot opt out of showing progress.
2. **Backward navigation preserves data (FR-009)**: `goBack()` never clears or mutates `data`. Re-visiting a step re-renders it pre-filled from `data`. Only re-entering *dependent* fields — i.e., a field whose valid value depended on an earlier answer that has now changed — is the step component's own responsibility to re-request; the shell itself never discards anything.
3. **No partial resource on abandonment (FR-010)**: `definition.onComplete` is the *only* place any network call that creates/attaches a real resource may happen, and it fires only from the final step's explicit confirmation. Intermediate steps must not call any create/attach endpoint. Unmounting `WizardShell` before `submit()` succeeds must leave zero trace server-side.
4. **Single submission**: `submit()` sets `isSubmitting = true` for its duration; `WizardShell` disables its own confirm control while `isSubmitting` is true, preventing double-submission (relevant given FR-010's no-partial-resource guarantee — a double click must not create two resources).
5. **Cancel/abandon is always available**: `WizardShell` always renders a way to leave the flow (e.g. a "Cancel" affordance) that unmounts without calling `onComplete`; this is what the Edge Cases section describes as "simply start again."

## What this contract does *not* cover

- Cross-session persistence of in-progress step data — explicitly out of scope (spec Assumptions); `WizardRuntimeState` (data-model.md) is in-memory only.
- Server-side validation results are still surfaced through each step's own error display (via `ErrorMessage`, see `error-message-catalog.md`), not through this contract — `isValid` here is client-side/shape validation only (e.g. "a target is selected"), not "the DNS zone actually exists."
