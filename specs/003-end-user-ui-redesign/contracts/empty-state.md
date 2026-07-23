# UI Contract: EmptyState

Governs `frontend/src/components/layout/EmptyState.tsx` (FR-019). Any list/overview screen that can legitimately have zero items MUST render this component instead of a bare empty list/table when its data resource resolves to an empty array.

## Props

```ts
interface EmptyStateProps {
  message: string;       // plain-language explanation (FR-013) — never blank
  actionLabel: string;   // call-to-action button text
  onAction: () => void;  // starts the relevant guided flow — never a no-op
}
```

## Required usages (initial set)

| Screen | Empty condition | `actionLabel` starts… |
|---|---|---|
| `IpClients` (Trigger Device overview) | zero Trigger Devices | Device Wizard |
| `Actions` (per-device action list) | zero Actions on that device | Action Wizard |

## Invariants

1. **Never a bare empty list**: a `0`-length resolved list on a covered screen always renders `EmptyState`, never an empty `<table>`/`<For>` with no explanatory content.
2. **Action always reachable**: `onAction` must be wired to actually open the corresponding wizard (`WizardShell`-based flow) — this is the FR-019 requirement that the empty state *directly* starts the flow, not just links to generic help text.
3. **Loading vs. empty are distinct states**: a resource that hasn't resolved yet (`fallback={<p>Loading…</p>}` today) must not be conflated with a resolved-but-empty resource — `EmptyState` only renders once the data is known to be empty, never while still loading.
