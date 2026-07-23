# Data Model: End-User UI Redesign

This feature introduces **no backend data model changes** — no new tables, aggregates, events, or API response shapes (see spec Assumptions and research.md §1/§2). The entities below are frontend-only view/state shapes that exist purely in the browser to support the redesigned interaction flow. They are not persisted server-side and have no bearing on the backend's event-sourced domain model (`backend/src/domain/**`), which this feature does not touch.

## Frontend-only entities

### WizardDefinition

Describes one of the three guided flows (onboarding, Trigger Device creation, Action configuration) as configuration passed into the shared `WizardShell`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable identifier, e.g. `"device-wizard"`. |
| `steps` | `WizardStepDefinition[]` | Ordered; rendered in this order; drives the "step X of N" indicator (FR-008). |
| `onComplete` | `(data: StepDataBag) => Promise<void>` | Invoked only once, on the final step's confirmation — the single point where the real backend call (e.g. `POST /ip-clients`, `POST /ip-clients/:id/actions`) is made, so no partial resource is ever created from an abandoned flow (FR-010). |

### WizardStepDefinition

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within its `WizardDefinition`. |
| `title` | string | Plain-language step label shown in the progress indicator (FR-013). |
| `component` | Solid component | Renders the step's fields; reads/writes its slice of the shared `StepDataBag`. |
| `isValid` | `(data: StepDataBag) => boolean` | Gates whether "Next" is enabled for this step (supports FR-009: can't move forward with invalid/missing data, but moving *back* is always allowed). |

### WizardRuntimeState (held by `useWizard`)

| Field | Type | Notes |
|---|---|---|
| `currentStepIndex` | number | 0-based; in-memory only, reset on remount (no cross-session persistence — spec Assumptions). |
| `data` | `StepDataBag` | Accumulated answers from all visited steps; a step revisited via "Back" keeps its previously entered values (FR-009). |
| `isSubmitting` | boolean | True only during the final `onComplete` call; used to disable double-submission. |

### OnboardingProgressFlag

The one piece of frontend state that *does* persist, and only in `localStorage` (never sent to the backend).

| Field | Type | Notes |
|---|---|---|
| key | `` fluxip.onboarding.<tenantId>.completed `` | `tenantId` is the Logto `sub` claim already used as the account aggregate ID server-side; namespacing by it means multiple accounts on one shared browser don't leak each other's onboarding state. |
| value | `"true"` \| absent | Absent ⇒ show the onboarding flow on next authenticated render for that tenant; set once the flow is completed or dismissed. |

### ErrorMessageMapping entry

One row of the lookup table in `frontend/src/lib/errors.ts` (research.md §8).

| Field | Type | Notes |
|---|---|---|
| `match` | `{ status?: number; errorBody?: string }` | What a raw backend failure looks like (HTTP status and/or the existing `{ error: string }` body). |
| `message` | string | The plain-language, user-facing replacement (FR-013/014/015) — never the raw `match` values themselves. |
| *(fallback)* | string | One catch-all message used when no `match` applies, so an unmapped error can never surface raw text. |

### EmptyStateContent

Props for the shared `EmptyState` component (FR-019).

| Field | Type | Notes |
|---|---|---|
| `message` | string | Plain-language explanation that the list is empty. |
| `actionLabel` | string | Call-to-action button text. |
| `onAction` | `() => void` | Starts the relevant guided flow (device wizard, action wizard, or the onboarding flow). |

## Existing backend entities this UI operates on (unchanged)

For traceability only — full definitions live in `specs/001-ip-change-automation/data-model.md`, not repeated or modified here: **User Account**, **Trigger Device** (API/UI name: "IP Client"), **Action**, **Provider Credential**, **Notification Channel**, **Execution Record**. This feature changes only how these are presented and navigated, never their shape or behavior.
