# Feature Specification: Hetzner Cloud Firewall Rule Action

**Feature Branch**: `007-hetzner-firewall-action`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Add a new Action type: Hetzner Cloud Firewall Rule Update, extending FluxIP's existing Action mechanism (FR-009/FR-035 of 001-ip-change-automation already anticipate this as a future Hetzner-related Action type). The Action keeps one specific rule of one specific Hetzner Cloud Firewall synchronized with a Trigger Device's current IP address(es), touching only the address entries it previously added itself and leaving all other entries (static IPs, other Actions' entries) untouched. Users choose IPv4 and/or IPv6 per Action, and explicitly configure which firewall and which rule to manage (no auto-discovery)."

## Clarifications

### Session 2026-09-01

- Q: When a user reconfigures an existing Firewall Rule Update Action to stop managing an address family it previously managed (e.g. IPv6 is disabled after being active), what should happen to the entry it previously added for that family? → A: The previously-added entry for that family is removed (best-effort), consistent with the existing Detach cleanup behavior.
- Q: Does the "no lost updates" concurrency guarantee (FR-009) need to protect against races with manual edits made directly in the Hetzner Console, or only against concurrent FluxIP-initiated updates? → A: Only FluxIP-initiated updates are protected; a concurrent manual edit in the Hetzner Console at the same moment is a known, accepted limitation.
- Q: Should the configured rule selector (firewall + rule) be validated against Hetzner at Action configuration time, or only at first execution time? → A: Eager — validated immediately at configuration time, rejecting the configuration with a diagnosable error if it doesn't resolve to exactly one rule.
- Q: If the best-effort removal on Detach/Reconfigure (FR-011/FR-017) fails, is it automatically retried later, or is it a single one-shot attempt? → A: Single one-shot attempt only; no automatic retry.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep a firewall rule pointed at a device's current IP (Priority: P1)

A user runs a service (e.g. SSH, a management console) on a Hetzner Cloud server, restricted by a Firewall rule to specific source addresses. One of the allowed sources is a home Trigger Device (e.g. a router) whose public IP changes periodically. The user configures a Firewall Rule Update Action on that Trigger Device, pointing at the firewall and rule that must always include the device's current address. When the device's IP changes, the rule is updated automatically, so the user keeps access without manually editing firewall rules.

**Why this priority**: This is the entire value proposition of the feature — without it, nothing else matters.

**Independent Test**: Attach a Firewall Rule Update Action to a Trigger Device, pointing at an existing firewall rule. Trigger an IP change. Verify the rule's address list now contains the new address.

**Acceptance Scenarios**:

1. **Given** an enabled Firewall Rule Update Action attached to a Trigger Device, **When** the device reports a new IP address for an address family the Action manages, **Then** the configured firewall rule's address list is updated to include the new address for that family.
2. **Given** an Action that has already run once and set an address in the rule, **When** the device's IP changes again, **Then** the rule contains only the new address for that Action (the previous one is gone), not both.
3. **Given** a user configuring a Firewall Rule Update Action, **When** they submit a rule selector that does not resolve to exactly one existing rule on the specified firewall, **Then** the configuration is rejected immediately with a diagnosable error, before the Action is created.

---

### User Story 2 - Other entries in the same rule are never touched (Priority: P1)

A firewall rule the Action manages also contains other addresses that are not related to this Action — for example a colleague's static office IP entered manually, or an address maintained by a different Trigger Device's own Action pointed at the same rule. When this Action updates the rule, only the address it previously added itself changes; every other entry is left exactly as it was.

**Why this priority**: Without this guarantee, the Action is unsafe to use on any firewall rule that isn't exclusively dedicated to it, which would make the feature unusable for the realistic case of a shared rule.

**Independent Test**: Manually add a static address to the target rule, then let the Action run through two IP changes. Verify the static address is still present, unmodified, after both runs, and that only the Action's own entry changed.

**Acceptance Scenarios**:

1. **Given** a target rule that contains addresses not managed by this Action, **When** the Action updates the rule, **Then** those unrelated addresses remain present and unchanged.
2. **Given** two different Firewall Rule Update Actions (from different Trigger Devices) configured against the same rule, **When** one Action's Trigger Device reports an IP change, **Then** only that Action's own address entry changes; the other Action's entry is unaffected.

---

### User Story 3 - Choose which address families the Action manages (Priority: P2)

A user's Trigger Device may only need its IPv4 address tracked in the firewall rule, only its IPv6 address, or both. The user selects this when configuring the Action, independent of what the Trigger Device itself reports.

**Why this priority**: Necessary for correctness in mixed-stack and IPv6-only or IPv4-only environments, but the feature already delivers value for the common single-family case without it being fully general.

**Independent Test**: Configure an Action for IPv4 only. Trigger a device IP change that reports both a new IPv4 and a new IPv6 address. Verify only the rule's IPv4-related entry changes.

**Acceptance Scenarios**:

1. **Given** an Action configured to manage only IPv4, **When** the device reports a change to both its IPv4 and IPv6 address, **Then** only the IPv4 entry in the rule is updated.
2. **Given** an Action configured to manage both IPv4 and IPv6, **When** the device reports a change to only one family, **Then** only that family's entry is updated and the other family's previously-set entry is left as is.
3. **Given** an Action that is reconfigured to newly manage an address family it did not manage before, **When** it next runs, **Then** it adds the current address for that family without removing or assuming any prior entry for it.
4. **Given** an Action that is reconfigured to stop managing an address family it previously managed, **When** the reconfiguration is applied, **Then** the system attempts to remove the entry it previously added for that family from the rule.

---

### User Story 4 - Clean up after removing the Action (Priority: P3)

When a user no longer wants the automation for a given rule and detaches the Action, the address entry it previously added is removed from the firewall rule, so stale access isn't left open indefinitely.

**Why this priority**: A hygiene/security nicety on top of the core automation; the feature is still useful without it, but leaving stale entries behind is a real drawback if it doesn't clean up.

**Independent Test**: Attach an Action, let it run once so it adds an entry, then detach it. Verify the entry it added is no longer present in the rule, and that other entries are untouched.

**Acceptance Scenarios**:

1. **Given** an Action that has previously added an address entry to its target rule, **When** the user detaches the Action, **Then** the system attempts to remove that entry from the rule.
2. **Given** the removal in the previous scenario cannot be completed (e.g. Hetzner is unreachable or the credential was already revoked), **When** the user detaches the Action, **Then** the detachment still completes and the removal failure is visible to the user rather than silently lost.

---

### Edge Cases

- A user submits a rule selector that matches no rule, or more than one rule, on the firewall at configuration time → the configuration is rejected immediately with a diagnosable error; no Action is created.
- The configured rule selector matched exactly one rule at configuration time but no longer does at update time (e.g. the rule was deleted or renamed directly in Hetzner after the Action was configured) → the update fails with a diagnosable error; the firewall is left unmodified.
- Two Actions (possibly from different Trigger Devices) target rules on the same firewall and are triggered at close to the same time → both updates are applied; neither is silently lost due to the other.
- The device reports an IP change for an address family the Action isn't configured to manage → that family is ignored.
- The firewall or the credential used to reach it is deleted or revoked at execution time → the update fails with a diagnosable error, consistent with how other Hetzner-dependent Actions already report such failures.
- The Action's target rule was already deleted at the time of Detach → cleanup is attempted, fails gracefully, and is logged; detachment still succeeds.
- A user edits the target rule directly in the Hetzner Console at the same moment an Action update is in flight → the two changes may race; only concurrent updates among FluxIP-initiated Actions are guaranteed not to be lost (see Assumptions), a concurrent manual edit is a known, accepted limitation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a new Action type that keeps one rule of one Hetzner Cloud Firewall's source address list synchronized with the current IP address(es) of the Action's Trigger Device.
- **FR-002**: Users configuring this Action type MUST explicitly specify which Hetzner Cloud Firewall and which rule within it the Action manages; the system MUST NOT automatically discover or guess the target rule.
- **FR-003**: Users MUST be able to identify the target rule unambiguously at configuration time (e.g. by a combination of its direction, protocol, port, and description).
- **FR-004**: Users MUST be able to choose, independently, whether the Action manages the Trigger Device's IPv4 address, IPv6 address, or both, for the target rule.
- **FR-005**: When the Trigger Device's IP address changes for an address family the Action manages, System MUST update the target rule's address list with the new address for that family.
- **FR-006**: System MUST only ever add, change, or remove the address list entries that this specific Action previously added itself; all other entries in the target rule — added by other Actions, other Trigger Devices, or entered manually — MUST remain unchanged by this Action's updates.
- **FR-007**: When the Action manages a given address family for the first time (its first execution, or an address family newly added to an already-configured Action), System MUST add the current address for that family without assuming or removing any prior entry.
- **FR-008**: If the configured rule identification does not match exactly one existing rule on the firewall at update time (none found, or more than one match), System MUST fail the update with a diagnosable error and MUST NOT modify the firewall.
- **FR-009**: System MUST prevent concurrent updates *initiated by FluxIP itself* that target the same firewall from silently overwriting one another — no update may be lost because another FluxIP-initiated update to the same firewall happened around the same time. Protecting against a concurrent manual edit made directly in the Hetzner Console at the same moment is explicitly out of scope (see Assumptions).
- **FR-010**: When a Firewall Rule Update Action is detached, System MUST attempt to remove the address list entries it previously added to the target rule.
- **FR-011**: If the removal in FR-010 cannot be completed, System MUST still complete the detachment and MUST make the removal failure visible/diagnosable rather than blocking detachment. This removal is a single one-shot attempt; System MUST NOT automatically retry it later.
- **FR-012**: System MUST reuse the existing Hetzner provider credential type for authenticating this Action's communication with Hetzner; no new credential type is introduced.
- **FR-013**: All communication this Action type performs with Hetzner MUST go exclusively through the current Hetzner Cloud API, consistent with FR-035 of 001-ip-change-automation — never the legacy, separate Hetzner DNS API.
- **FR-014**: System MUST express addresses in the target rule in the format Hetzner's Firewall API requires, even when the Trigger Device reports a single address rather than an address range.
- **FR-015**: This Action type MUST be selectable in the same Action-configuration flow already used for existing Action types (e.g. the Hetzner DNS Update Action), without redesigning that flow.
- **FR-016**: Execution history and failure diagnostics for this Action type MUST follow the same visibility model already provided for existing Action types (e.g. viewable execution outcomes and error reasons).
- **FR-017**: When a user reconfigures a Firewall Rule Update Action to stop managing an address family it previously managed, System MUST attempt to remove the entry it previously added for that family from the target rule; if that removal cannot be completed, the reconfiguration MUST still be applied and the removal failure MUST be visible/diagnosable, consistent with FR-011. This removal is likewise a single one-shot attempt with no automatic retry.
- **FR-018**: System MUST validate, at Action configuration time, that the configured rule selector resolves to exactly one existing rule on the specified firewall, and MUST reject the configuration with a diagnosable error if it does not (before the Action is created).

### Key Entities

- **Firewall Rule Update Action**: A specialization of the existing Action entity. In addition to the attributes every Action has (Trigger Device, enabled/disabled status, managed address families), it holds: the target Hetzner Cloud Firewall, a selector identifying exactly one rule within that firewall, and — per managed address family — the address entry it currently owns within that rule's address list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can configure a working Firewall Rule Update Action against an existing firewall rule in under 5 minutes, given they already have a Hetzner provider credential set up.
- **SC-002**: At least 99% of confirmed IP changes result in the corresponding firewall rule being updated within 5 minutes of the change being reported to the system, matching the existing DNS Action's propagation expectation.
- **SC-003**: Across a sustained test of repeated updates, entries in a target rule that do not belong to the Action under test are never modified or removed — zero unrelated-entry interference.
- **SC-004**: When two Actions update rules on the same firewall at close to the same time, a sustained test of at least 100 concurrent update pairs shows zero lost updates (both Actions' changes are always present afterward).
- **SC-005**: A user reviewing a failed firewall rule update can identify the reason for the failure, without contacting support, in at least 90% of failure cases — matching the existing Action execution diagnostics bar.
- **SC-006**: After detaching a Firewall Rule Update Action under normal conditions (firewall reachable, credential valid), the entry it previously added is confirmed removed from the rule in at least 99% of detachments.

## Assumptions

- One Action instance manages exactly one rule on one firewall, mirroring the existing Hetzner DNS Action's "one record per Action" scope. A user needing multiple rules updated attaches multiple Actions to the same Trigger Device — already supported by the existing Action model.
- The target firewall and rule must already exist in Hetzner before the Action is configured; this Action type never creates firewalls or rules, only updates the address list of an existing rule.
- Configuration of the target firewall and rule is done via direct input of their identifying details (as used by the Hetzner Cloud API) rather than a browse-and-select experience against the user's live Hetzner account; a guided picker is a possible future enhancement, not required for this feature.
- The existing Hetzner provider credential type already covers the permissions needed to read and update firewall rules; no new credential type or credential scope concept is introduced by this feature.
- Rate limits or quota constraints imposed by the Hetzner Cloud API itself are out of scope for this specification, consistent with how the existing DNS Action already treats third-party API limits as an operational concern rather than a functional requirement.
- The no-lost-updates guarantee (FR-009) covers only updates initiated by FluxIP itself; detecting or reconciling a concurrent manual edit made directly in the Hetzner Console is out of scope for this iteration.
