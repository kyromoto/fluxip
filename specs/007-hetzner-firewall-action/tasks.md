---

description: "Task list for Hetzner Cloud Firewall Rule Action"
---

# Tasks: Hetzner Cloud Firewall Rule Action

**Input**: Design documents from `/specs/007-hetzner-firewall-action/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Included — plan.md and quickstart.md already commit to specific unit, contract, and integration test files as part of the design (mirroring 004-credential-management's approach), so the test tasks below are real deliverables, not optional extras.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- File paths are relative to the repository root, per plan.md's Project Structure

## Path Conventions

Existing web application per plan.md: `backend/src/`, `backend/tests/`, `frontend/src/`, `frontend/tests/`. This feature extends the `action` aggregate, `ActionExecutor` port, execution worker, and Action wizard already built in 001-ip-change-automation — no new package or top-level directory; one new adapter directory (`backend/src/adapters/actions/hetzner-firewall/`), sibling to the existing `hetzner-dns/` one.

---

## Phase 1: Setup

No new project setup is required. This feature adds no new dependency, Docker service, or workspace package (plan.md Technical Context) — Redis/`ioredis` are already present via BullMQ. Proceed directly to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared domain types and low-level building blocks every user story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T001 [P] Add `HETZNER_CLOUD_FIREWALL_RULE_UPDATE_ACTION_TYPE`, `UpdateFirewallRuleConfig` (`providerCredentialId, firewallId: number, direction: "in"|"out", protocol, port?, description`), widen `ActionConfig` to a union, and add `ActionEventName.FirewallRuleApplied` + `ActionFirewallRuleAppliedData` (`{ actionId, ipv4?, ipv6?, appliedAt }`) in backend/src/domain/action/events.ts (data-model.md)
- [X] T002 Add `firewallOwnedEntries: { ipv4?: string; ipv6?: string }` to `ActionState`/`initialActionState` and fold `FirewallRuleApplied` events into it (overwrite only the families present in the event) in backend/src/domain/action/action-aggregate.ts (depends on T001)
- [X] T003 [P] Implement pure `matchFirewallRule(rules, selector): { rule } | { error: "no_match" } | { error: "ambiguous_match"; matchCount }` in backend/src/domain/action/firewall-rule-selector.ts (data-model.md "Non-persisted domain type"; research.md §5)
- [X] T004 [P] Implement a thin Hetzner Cloud API client — `getFirewall(token, firewallId)` (`GET /firewalls/{id}`) and `setFirewallRules(token, firewallId, rules)` (`POST /firewalls/{id}/actions/set_firewall_rules`), reusing `hetzner-dns-executor.ts`'s `requestJson` diagnosable-error convention — in backend/src/adapters/actions/hetzner-firewall/hetzner-firewall-client.ts (contracts/hetzner-firewall-api.md)
- [X] T005 [P] Implement an advisory Redis lock keyed `firewall-lock:{accountId}:{firewallId}` (`SET NX PX` + a token-checked Lua release script) in backend/src/adapters/actions/hetzner-firewall/hetzner-firewall-lock.ts (research.md §2)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Keep a Firewall Rule Pointed at a Device's Current IP (Priority: P1) 🎯 MVP

**Goal**: A user can configure a Firewall Rule Update Action against an existing Hetzner firewall rule, and the rule's address list automatically tracks the Trigger Device's current IP.

**Independent Test**: Run quickstart.md Scenario 1 — attach a Firewall Rule Update Action pointing at a real rule, confirm a mistyped selector is rejected before the Action exists, trigger two IP changes, and confirm the rule ends up with only the newest address.

### Tests for User Story 1

- [X] T006 [P] [US1] Unit test for `matchFirewallRule`: exactly-one-match, zero-match, ambiguous-match (same direction/protocol/port, different description) in backend/tests/unit/domain/firewall-rule-selector.test.ts (depends on T003)
- [X] T007 [P] [US1] Unit test for the firewall executor: CIDR normalization (single IPv4/IPv6 → `/32`/`/128`), first-run appends without removing, second run replaces only the previously-owned entry, lock is acquired around the read-modify-write and released after, **and the execution-time failure path required by FR-008 (rule selector matched at configuration time but no longer resolves to exactly one rule when the executor runs — e.g. deleted/renamed directly in Hetzner — fails the execution and leaves the firewall unmodified)** in backend/tests/unit/adapters/actions/hetzner-firewall-executor.test.ts (depends on T009 existing — write against the task below, iterate together)
- [X] T008 [P] [US1] Contract test: `POST /ip-clients/:id/actions` and `PUT /actions/:id` with a firewall config reject missing fields (400), an unreachable/invalid `firewallId` (400 `"firewall_not_found"`), a non-matching selector (422 `"rule_selector_no_match"`), and an ambiguous selector (422 `"rule_selector_ambiguous"`) — in every case before any domain event is appended — in backend/tests/contract/actions.test.ts (contracts/actions-api.md)

### Implementation for User Story 1

- [X] T009 [US1] Implement `HetznerFirewallExecutor` (`ActionExecutor` for the new type) in backend/src/adapters/actions/hetzner-firewall/hetzner-firewall-executor.ts: normalize the reported address(es) to CIDR, and export a standalone `applyFirewallRuleUpdate(config, { remove?: Partial<Record<AddressFamily,string>>, add?: Partial<Record<AddressFamily,string>> })` helper that acquires the lock (T005), calls `getFirewall` (T004), resolves the target rule via `matchFirewallRule` (T003, failing per FR-008 if not exactly one match), removes `remove`'s entries and appends `add`'s entries in the matched rule's `source_ips`/`destination_ips` (per `direction`) leaving every other entry untouched (FR-006), calls `setFirewallRules` (T004), and releases the lock; `execute()` itself just calls this helper with `remove` = the action's current `firewallOwnedEntries` for the families being updated and `add` = the new addresses (depends on T002-T005)
- [X] T010 [US1] Wire the new executor into the worker: `resolveFirewallExecutorConfig` (decrypt credential, pass through `firewallId`/selector), register the executor, and after a successful execution append `action.firewall_rule_applied` with the written CIDRs — reloading the `action` aggregate immediately before the append and retrying once on an `expectedSequenceNumber` conflict, logging (not failing the execution) if it still conflicts — in backend/src/adapters/queue-bullmq/action-execution-worker.ts (research.md §4; depends on T009)
- [X] T011 [US1] Extend `POST /ip-clients/:id/actions` and `PUT /actions/:id` to accept the firewall config shape and, before appending any event, decrypt the credential, call `getFirewall` (T004), and reject via `matchFirewallRule` (T003) per the error table in contracts/actions-api.md (FR-018) in backend/src/adapters/http/routes/actions.ts (depends on T001, T003, T004)
- [X] T012 [P] [US1] Create `FirewallRuleTargetStep`: credential select (filtered to the `"hetzner"` provider, same pattern as `DnsTargetStep`'s `REQUIRED_PROVIDER` map) plus `firewallId` (number input), `direction` (in/out select), `protocol` (select), `port` (text input, shown only for tcp/udp), `description` (text input, required) in frontend/src/flows/action-wizard/steps/FirewallRuleTargetStep.tsx
- [X] T013 [US1] Make `ChooseActionTypeStep` interactive: render both Action types as selectable cards and call `props.updateData({ type })` on selection, instead of the current static single-card display in frontend/src/flows/action-wizard/steps/ChooseActionTypeStep.tsx
- [X] T014 [US1] Widen `ActionWizardData` to a flat superset covering both types (`type` union, DNS fields, and the new `firewallId`/`direction`/`protocol`/`port`/`description` fields); add an inline `TargetStep` dispatcher component for the `"target"` wizard step that renders `DnsTargetStep` or `FirewallRuleTargetStep` (T012) based on `data.type`, with a matching type-conditional `isValid`; branch `onComplete` to build the right `config` object and call the existing `POST`/`PUT` with `type: "hetzner_cloud_firewall_rule_update"` when applicable in frontend/src/flows/action-wizard/ActionWizard.tsx (depends on T012, T013)
- [X] T015 [P] [US1] Frontend unit test: `FirewallRuleTargetStep` renders and updates all fields (`firewallId`, `direction`, `protocol`, `port`, `description`), filters the credential dropdown to the `"hetzner"` provider (same assertions as `dns-target-step.test.tsx`'s credential-filtering case), and the wizard's `isValid` gate for this step correctly requires `firewallId`/`direction`/`protocol`/`description` in frontend/tests/unit/firewall-rule-target-step.test.tsx (depends on T012, T014)
- [X] T016 [P] [US1] Extend the existing Playwright spec with the firewall Action type path: choose "Hetzner Cloud Firewall Rule Update" in `ChooseActionTypeStep`, fill `FirewallRuleTargetStep`'s fields, complete the wizard, and confirm the Action is created in frontend/tests/e2e/action-wizard.spec.ts (depends on T013, T014)

### Validation for User Story 1

- [X] T017 [US1] Run quickstart.md Scenario 1 and confirm outcomes

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP slice.

---

## Phase 4: User Story 2 - Other Entries in the Same Rule Are Never Touched (Priority: P1)

**Goal**: Confirm the safety property that makes the Action usable on a shared rule — unrelated entries (static IPs, other Actions' entries) survive every update, including when two Actions update the same firewall concurrently.

**Independent Test**: Run quickstart.md Scenario 2 (and Scenario 5 for the concurrency half) — manually add a static entry, run the Action through two updates and confirm it's untouched; run two Actions against the same firewall at close to the same time and confirm neither update is lost.

No new implementation is needed for this story — the "only touch my own entries" behavior is inherent to how `applyFirewallRuleUpdate` (T009) is built, and the concurrency guarantee is `hetzner-firewall-lock.ts` (T005) as already wired into T009/T010. This story proves both properties end-to-end.

### Tests for User Story 2

- [X] T018 [P] [US2] Integration test (Testcontainers, real Postgres + Redis): a static CIDR manually added to the target rule survives two Action-driven updates; a second Action (different Trigger Device) on the same rule keeps its own entry independent of the first; two Actions updating different rules on the *same* firewall at the same time both succeed with neither update lost (FR-009/SC-004) in backend/tests/integration/firewall-rule-action-lifecycle.test.ts (depends on T009, T010, T005). This proves the locking mechanism is correct in principle at pair-scale — it does not exercise SC-004's stated "at least 100 concurrent update pairs" volume, which is a production/load-test concern (see quickstart.md "What this quickstart does not cover")

### Validation for User Story 2

- [X] T019 [US2] Run quickstart.md Scenarios 2 and 5 and confirm outcomes (depends on T018)

**Checkpoint**: User Stories 1 and 2 both hold — the core executor is proven correct and safe for shared rules.

---

## Phase 5: User Story 3 - Choose Which Address Families the Action Manages (Priority: P2)

**Goal**: A user can independently enable/disable IPv4 and IPv6 for a Firewall Rule Update Action, including adding or dropping a family on an already-configured Action.

**Independent Test**: Run quickstart.md Scenario 3 — configure IPv4-only, confirm an IPv6 change is ignored; add IPv6, confirm it's appended without disturbing IPv4; drop IPv6, confirm its entry is removed from the rule shortly after.

### Implementation for User Story 3

- [X] T020 [US3] Generalize `AddressFamilyStep`'s copy so it isn't DNS-specific (drop or branch the "(A record)"/"(AAAA record)" wording by `props.data.type`) in frontend/src/flows/action-wizard/steps/AddressFamilyStep.tsx
- [X] T021 [US3] Extend `PUT /actions/:id`: after appending `action.reconfigured`, if the new `addressFamilies` drops a family present in the Action's `firewallOwnedEntries`, make a single best-effort call to `applyFirewallRuleUpdate` (T009) with only `remove` set for that family — log-only on failure, never blocks or reverts the response — in backend/src/adapters/http/routes/actions.ts (FR-017; depends on T009, T011)

### Tests for User Story 3

- [X] T022 [P] [US3] Unit/contract coverage: reconfiguring to add a never-before-managed family appends without removing anything (FR-007); reconfiguring to drop a managed family triggers the best-effort removal call; a failed removal doesn't block the `200` response — extending backend/tests/unit/adapters/actions/hetzner-firewall-executor.test.ts and backend/tests/contract/actions.test.ts (depends on T021)

### Validation for User Story 3

- [X] T023 [US3] Run quickstart.md Scenario 3 and confirm outcomes (depends on T020-T022)

**Checkpoint**: All three of US1-US3 are independently functional.

---

## Phase 6: User Story 4 - Clean Up After Removing the Action (Priority: P3)

**Goal**: Detaching a Firewall Rule Update Action removes the entry it previously added, without ever blocking the detach itself.

**Independent Test**: Run quickstart.md Scenario 4 — let an Action run once, detach it, confirm its entry is gone from the rule and that the detach response wasn't held up waiting on Hetzner.

### Implementation for User Story 4

- [X] T024 [US4] Extend `DELETE /actions/:id`: after appending `action.detached` (unconditionally), make a single best-effort call to `applyFirewallRuleUpdate` (T009) removing every family in `firewallOwnedEntries` — log-only on failure, response is unaffected either way — in backend/src/adapters/http/routes/actions.ts (FR-010/FR-011; depends on T009)

### Tests for User Story 4

- [X] T025 [P] [US4] Integration test: detach after one successful execution removes the owned entry from the rule; detach while the credential is revoked/Hetzner unreachable still returns success and logs the cleanup failure — extending backend/tests/integration/firewall-rule-action-lifecycle.test.ts (depends on T024)

### Validation for User Story 4

- [X] T026 [US4] Run quickstart.md Scenario 4 and confirm outcomes (depends on T025)

**Checkpoint**: All four user stories are independently functional; the full feature is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T027 [P] Type-check and lint both packages (`pnpm -r typecheck`, `pnpm -r lint`) and fix any issues surfaced by the changes above
- [X] T028 Run the full quickstart.md validation pass (all five manual scenarios plus every automated check listed) and fix any discovered issues

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: None — no tasks
- **Foundational (Phase 2)**: No dependencies beyond existing code (001's `action` aggregate, `ActionExecutor` port, BullMQ/`ioredis`) — BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational completion
  - US1 has no dependency on US2/US3/US4
  - US2 depends on US1's executor (T009) and worker wiring (T010) existing to prove correct — otherwise independently testable per its own Independent Test
  - US3 depends on US1's `applyFirewallRuleUpdate` helper (T009) and route (T011) existing to extend
  - US4 depends on US1's `applyFirewallRuleUpdate` helper (T009) existing to call — independent of US2/US3
- **Polish (Phase 7)**: Depends on all four user stories being complete

### Within Each User Story

- Tests before/alongside the implementation task(s) they cover, per T006-T008 preceding T009-T014; T007 in particular is written against T009 iteratively (same executor, one behavior); T015/T016 (frontend tests) necessarily follow T012-T014, since they test what those tasks build
- Domain/backend before frontend within US1 (T009-T011 before T012-T014), since the wizard's `onComplete` calls the routes T011 defines — but the two can proceed in parallel in practice since the frontend only needs the *shape* of the config, already fixed by data-model.md
- Backend route changes are sequential within `actions.ts` (T011 → T021 → T024, each editing the same file)

### Parallel Opportunities

- T001, T003, T004, T005 (Foundational, different files) in parallel; T002 waits on T001
- T006, T007, T008 (US1 backend tests, different files) in parallel with each other and with T012 (frontend, different package)
- T015 and T016 (US1 frontend tests, different files) in parallel with each other once T012-T014 land, and with any US1 backend cleanup
- T018 (US2) can start as soon as T009/T010 land, independent of US1's frontend tasks (T012-T016)
- T022 and T025 (US3/US4 tests, different files) in parallel with each other once their respective route changes (T021/T024) land
- T027 (Polish) has no story-specific dependency beyond all stories being implemented

---

## Parallel Example: User Story 1

```bash
# Backend and frontend work can proceed in parallel once Foundational (T001-T005) is done:
Task: "Implement HetznerFirewallExecutor + applyFirewallRuleUpdate in backend/src/adapters/actions/hetzner-firewall/hetzner-firewall-executor.ts"
Task: "Create FirewallRuleTargetStep in frontend/src/flows/action-wizard/steps/FirewallRuleTargetStep.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational
2. Complete Phase 3: User Story 1
3. **STOP and VALIDATE**: Run quickstart.md Scenario 1 independently
4. Deploy/demo if ready — a working Firewall Rule Update Action for the common single-family, single-Action-per-rule case; the own-entries-only mutation logic (T009) already makes it safe to use on a rule with pre-existing static entries even before US2's tests formally prove it

### Incremental Delivery

1. Foundational → Foundation ready
2. Add User Story 1 → validate independently → deploy/demo (MVP)
3. Add User Story 2 → validate independently → deploy/demo (shared-rule safety and concurrency formally proven)
4. Add User Story 3 → validate independently → deploy/demo (per-family add/drop, including cleanup on drop)
5. Add User Story 4 → validate independently → deploy/demo (detach cleanup)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Do not commit automatically; commits are only created on the user's explicit request (see constitution's Explicit Commit Authorization principle)
- Stop at any checkpoint to validate story independently
- `applyFirewallRuleUpdate` (T009) is the one piece of logic every later story (US2-US4) either proves (US2) or extends the call sites of (US3/US4) — it is deliberately built once, in US1, as the single locked read-modify-write path research.md §2/§3 call for, rather than duplicated per call site
- SC-004's "at least 100 concurrent update pairs" volume is intentionally not what T018 asserts — see T018's own note and quickstart.md
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
