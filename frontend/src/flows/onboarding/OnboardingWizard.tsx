import { useNavigate } from "@solidjs/router";
import { useWizard, type WizardDefinition } from "~/flows/wizard/useWizard";
import { WizardShell } from "~/flows/wizard/WizardShell";
import { api } from "~/services/api";
import { FirstDevicePromptStep } from "./steps/FirstDevicePromptStep";
import { NotificationPreferenceStep } from "./steps/NotificationPreferenceStep";
import { WelcomeStep } from "./steps/WelcomeStep";

export interface OnboardingData {
  /** Comma-separated email addresses; empty means "skip notifications for now". */
  notificationAddresses: string;
  wantsFirstDevice: boolean;
}

interface OnboardingWizardProps {
  /** Marks the flag complete and dismisses for this session (User Story 1). */
  onComplete: () => void;
  /** Dismisses for this session only, WITHOUT marking complete — reappears next visit. */
  onCancel: () => void;
}

/**
 * Native, in-app first-run flow shown once per tenant per browser
 * (research.md §1/§2) — credential creation itself stays on Logto's hosted
 * sign-up page; this wizard only covers what happens after a brand-new
 * user's first authenticated return.
 */
export function OnboardingWizard(props: OnboardingWizardProps) {
  const navigate = useNavigate();

  const definition: WizardDefinition<OnboardingData> = {
    id: "onboarding",
    initialData: { notificationAddresses: "", wantsFirstDevice: true },
    steps: [
      { id: "welcome", title: "Welcome", component: WelcomeStep, isValid: () => true },
      {
        id: "notifications",
        title: "Notifications",
        component: NotificationPreferenceStep,
        isValid: () => true,
      },
      {
        id: "first-device",
        title: "Your first device",
        component: FirstDevicePromptStep,
        isValid: () => true,
      },
    ],
    onComplete: async (data) => {
      const addresses = data.notificationAddresses
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      if (addresses.length > 0) {
        await api.post("/notification-channel", { type: "email", addresses });
      }
      props.onComplete();
      navigate(data.wantsFirstDevice ? "/ip-clients" : "/");
    },
  };

  const wizard = useWizard(definition);

  return <WizardShell wizard={wizard} onCancel={() => props.onCancel()} confirmLabel="Get started" />;
}
