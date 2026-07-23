import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { useWizard, type WizardDefinition, type WizardStepComponentProps } from "~/flows/wizard/useWizard";

interface TestData {
  name: string;
  confirmed: boolean;
}

const StepA: (props: WizardStepComponentProps<TestData>) => null = () => null;
const StepB: (props: WizardStepComponentProps<TestData>) => null = () => null;

function makeDefinition(onComplete = vi.fn().mockResolvedValue(undefined)): WizardDefinition<TestData> {
  return {
    id: "test-wizard",
    initialData: { name: "", confirmed: false },
    steps: [
      { id: "a", title: "Step A", component: StepA, isValid: (d) => d.name.length > 0 },
      { id: "b", title: "Step B", component: StepB, isValid: (d) => d.confirmed },
    ],
    onComplete,
  };
}

describe("useWizard", () => {
  it("starts at step 0 and reports total steps", () => {
    createRoot((dispose) => {
      const wizard = useWizard(makeDefinition());
      expect(wizard.currentStepIndex()).toBe(0);
      expect(wizard.totalSteps()).toBe(2);
      expect(wizard.currentStep().id).toBe("a");
      dispose();
    });
  });

  it("gates goNext on the current step's isValid (invariant: client-side validation gate)", () => {
    createRoot((dispose) => {
      const wizard = useWizard(makeDefinition());
      expect(wizard.canGoNext()).toBe(false);
      wizard.goNext();
      expect(wizard.currentStepIndex()).toBe(0); // blocked — name is empty

      wizard.updateStepData({ name: "Home Router" });
      expect(wizard.canGoNext()).toBe(true);
      wizard.goNext();
      expect(wizard.currentStepIndex()).toBe(1);
      dispose();
    });
  });

  it("goBack never clears previously entered data (invariant 2)", () => {
    createRoot((dispose) => {
      const wizard = useWizard(makeDefinition());
      wizard.updateStepData({ name: "Home Router" });
      wizard.goNext();
      expect(wizard.canGoBack()).toBe(true);

      wizard.goBack();
      expect(wizard.currentStepIndex()).toBe(0);
      expect(wizard.data().name).toBe("Home Router"); // preserved
      dispose();
    });
  });

  it("submit() only calls onComplete once, only from the last step (invariant 3)", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    await createRoot(async (dispose) => {
      const wizard = useWizard(makeDefinition(onComplete));

      // Attempting to submit from a non-last step must not call onComplete.
      await wizard.submit();
      expect(onComplete).not.toHaveBeenCalled();

      wizard.updateStepData({ name: "Home Router" });
      wizard.goNext();
      wizard.updateStepData({ confirmed: true });

      await wizard.submit();
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith({ name: "Home Router", confirmed: true });
      dispose();
    });
  });

  it("guards against double-submission while isSubmitting is true (invariant 4)", async () => {
    let resolveComplete: () => void = () => {};
    const onComplete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveComplete = resolve;
        }),
    );
    await createRoot(async (dispose) => {
      const wizard = useWizard(makeDefinition(onComplete));
      wizard.updateStepData({ name: "Home Router" });
      wizard.goNext();
      wizard.updateStepData({ confirmed: true });

      const first = wizard.submit();
      const second = wizard.submit(); // should be a no-op — already submitting
      resolveComplete();
      await Promise.all([first, second]);

      expect(onComplete).toHaveBeenCalledTimes(1);
      dispose();
    });
  });
});
