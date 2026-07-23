import { createMemo, createSignal, type Component } from "solid-js";

/** Props every wizard step component receives (contracts/wizard-shell.md). */
export interface WizardStepComponentProps<TData> {
  data: TData;
  updateData: (patch: Partial<TData>) => void;
}

export interface WizardStepDefinition<TData extends object> {
  id: string;
  /** Plain-language step label shown by the progress indicator (FR-008/FR-013). */
  title: string;
  component: Component<WizardStepComponentProps<TData>>;
  /** Client-side "can advance" gate — shape/presence checks only, not server-side validation. */
  isValid: (data: TData) => boolean;
}

export interface WizardDefinition<TData extends object> {
  id: string;
  steps: WizardStepDefinition<TData>[];
  initialData: TData;
  /**
   * The ONLY place a create/attach network call may happen (FR-010) — called
   * exactly once, only from the final step's explicit confirmation.
   */
  onComplete: (data: TData) => Promise<void>;
}

/** Shared step-state hook backing WizardShell (contracts/wizard-shell.md). */
export function useWizard<TData extends object>(definition: WizardDefinition<TData>) {
  const [currentStepIndex, setCurrentStepIndex] = createSignal(0);
  const [data, setData] = createSignal<TData>(definition.initialData);
  const [isSubmitting, setIsSubmitting] = createSignal(false);

  const currentStep = createMemo(() => definition.steps[currentStepIndex()]);
  const totalSteps = () => definition.steps.length;
  const isLastStep = createMemo(() => currentStepIndex() === definition.steps.length - 1);

  const canGoNext = createMemo(() => currentStep().isValid(data()));
  const canGoBack = createMemo(() => currentStepIndex() > 0);

  function updateStepData(patch: Partial<TData>): void {
    setData((prev) => ({ ...prev, ...patch }));
  }

  function goNext(): void {
    if (!canGoNext()) return;
    setCurrentStepIndex((i) => Math.min(i + 1, definition.steps.length - 1));
  }

  function goBack(): void {
    // Never clears/mutates `data` — revisited steps re-render pre-filled.
    if (!canGoBack()) return;
    setCurrentStepIndex((i) => Math.max(i - 1, 0));
  }

  async function submit(): Promise<void> {
    if (!isLastStep() || !canGoNext() || isSubmitting()) return;
    setIsSubmitting(true);
    try {
      await definition.onComplete(data());
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    currentStep,
    currentStepIndex,
    totalSteps,
    isLastStep,
    canGoNext,
    canGoBack,
    data,
    updateStepData,
    goNext,
    goBack,
    isSubmitting,
    submit,
  };
}

export type UseWizardReturn<TData extends object> = ReturnType<typeof useWizard<TData>>;
