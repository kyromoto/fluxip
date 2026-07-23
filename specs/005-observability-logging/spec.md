# Feature Specification: Operational Logging & Traceability (Anwendungs- und Zugriffsprotokoll)

**Feature Branch**: `005-observability-logging`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "Ergänzung zur bestehenden Spezifikation: Das System muss Vorgänge nachvollziehbar machen und über ein Zugriffsprotokoll verfügen.

Kernanforderungen:

- Jede Anwendungsaktivität (empfangene Trigger-Events, ausgeführte Aktionen, Fehler) wird protokolliert, sodass ein einzelner Vorgang (z.B. "IP-Änderung von Gerät X hat zu DNS-Update Y geführt") im Nachhinein durch das System hinweg nachverfolgt werden kann.
- Zusätzlich existiert ein separates Zugriffsprotokoll (Access Log), das eingehende HTTP-Anfragen an das Backend dokumentiert, unabhängig vom Anwendungsprotokoll.
- Anwendungsprotokoll und Zugriffsprotokoll sind zwei getrennte Ausgabeströme, keine gemeinsame Log-Datei/-Quelle.

Nicht-Ziele für diese Ergänzung:

- Keine Festlegung auf ein konkretes Logging-Werkzeug oder Ausgabeziel (Konsole, Datei, externer Log-Dienst); das ist eine Plan-Entscheidung."

## Clarifications

### Session 2026-07-23

- Q: Should a manually re-run execution's Application Log entries share the correlation identifier of the original operation being retried, or root a new correlation chain at the manual request itself? → A: A new correlation identifier rooted at the manual request itself, consistent with 001-ip-change-automation's existing `causationEventId` design (a manual execution's causation is the manual request's own ID, not the original trigger event's).
- Q: Should each Access Log entry include the caller's source IP address? → A: Yes — like a standard web-server access log; this system already treats IP addresses as core domain data (Trigger Devices' reported IPs), so this introduces no new category of sensitive data.
- Q: Must logging preserve the existing trigger-endpoint's <200ms p95 latency target (001 SC-002), or is some additional latency acceptable? → A: Logging MUST NOT cause that existing target to regress — an explicit, testable success criterion.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trace a Single Operation End to End (Priority: P1)

An operator investigating a support question ("why didn't Device X's DNS record update?") looks at the Application Log and follows one single operation — from the trigger event being received, through every Action executed because of it, to its final outcome (success or failure with a reason) — as one connected sequence, without having to guess which log lines belong together.

**Why this priority**: This is the entire reason this addendum exists. Without the ability to reconstruct one operation's full path through the system, the log is just noise that can't actually answer "what happened here?"

**Independent Test**: Can be fully tested by triggering an IP change that fans out to multiple Actions (including at least one failure), then confirming that every log entry belonging to that one trigger — the received event, each Action's execution, and any error — can be identified as part of the same operation and read back as a coherent sequence.

**Acceptance Scenarios**:

1. **Given** a Trigger Device reports an IP change, **When** the change is accepted, **Then** an Application Log entry records that the trigger event was received, tied to an identifier that also appears on every log entry produced because of it.
2. **Given** a confirmed IP change fans out to two Actions, **When** both execute, **Then** each Action's execution produces its own Application Log entry, and both entries can be identified as belonging to the same originating trigger event.
3. **Given** an Action execution fails, **When** the failure is logged, **Then** the Application Log entry includes enough detail (which Action, which device/account, and the failure reason) to diagnose it without consulting another system.
4. **Given** a completed operation with several related log entries, **When** an operator retrieves them by the shared identifier, **Then** they can reconstruct the operation's full sequence — trigger received, each Action executed, final outcome — in the correct order.

---

### User Story 2 - Review Incoming HTTP Traffic via a Separate Access Log (Priority: P2)

An operator wants to see what HTTP requests the backend has actually received — for example while investigating unexpected load, a suspicious pattern of requests, or confirming whether a particular endpoint was ever called — independent of what the application logic decided to do about each one.

**Why this priority**: This is a distinct, secondary concern from tracing business operations (User Story 1); it matters for operating and securing the deployment, but the product's core traceability value is already delivered by User Story 1 without it.

**Independent Test**: Can be fully tested by sending a mix of requests to the backend (valid and invalid, authenticated and not) and confirming every one of them produces a corresponding Access Log entry, retrievable independently of the Application Log.

**Acceptance Scenarios**:

1. **Given** any HTTP request reaches the backend, **When** it is handled (successfully or not), **Then** an Access Log entry is recorded for it.
2. **Given** a request that fails before reaching application logic (e.g., invalid credentials, malformed request), **When** it is rejected, **Then** it still produces an Access Log entry, even though it produces no corresponding Application Log entry.
3. **Given** an operator wants to review recent HTTP traffic, **When** they read the Access Log, **Then** they see only request-level information (method, path, status, timing, caller's source IP address) without needing to interpret Application Log content.

---

### User Story 3 - Trust That the Two Logs Never Mix (Priority: P3)

An operator configuring where each log goes (e.g., routing the Access Log to a different destination than the Application Log, for separate retention or access-control rules) needs confidence that the two are genuinely independent outputs, not a single combined stream that happens to look separable.

**Why this priority**: This formalizes and protects a guarantee already implied by User Stories 1 and 2; it matters most once an operator starts actually relying on the separation (e.g., granting different people access to each), which is a natural next step after the two logs exist at all.

**Independent Test**: Can be fully tested by generating both Application Log and Access Log activity simultaneously and confirming each output stream contains only its own kind of entries, with neither depending on the other to function.

**Acceptance Scenarios**:

1. **Given** the system is running normally, **When** both Application Log and Access Log entries are produced, **Then** they are two distinct output streams — no entry belonging to one ever appears in the other.
2. **Given** the destination for one log stream becomes unavailable, **When** activity continues, **Then** the other log stream keeps recording unaffected.

---

### Edge Cases

- What happens when the logging mechanism itself fails or its destination is temporarily unavailable? The underlying request handling or Action execution MUST NOT fail or be blocked because of it — logging is best-effort with respect to the business operation it's describing.
- What happens when a single trigger event fans out to multiple Actions, some succeeding and some failing? Every Action's log entry (success or failure) carries the same correlation identifier back to the originating trigger event, so the full fan-out remains traceable as one operation.
- What happens when an HTTP request never reaches authenticated application logic (e.g., rejected at authentication)? It still produces an Access Log entry; the absence of tenant/account context on that entry is not an error.
- What happens when a log entry would otherwise include a secret value (e.g., a Provider Credential's token, a Trigger Device's reporting credential, an Authorization header)? That value MUST NOT appear in plaintext in either log stream.
- What happens when a manual re-run of a failed Action is triggered (per the core specification's existing manual re-run capability)? It is logged the same way as an automatic execution, but as its own operation — its Application Log entries carry a correlation identifier rooted at the manual request itself, not the original trigger event's, consistent with the core specification's existing causation model for manual executions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST record an Application Log entry whenever a Trigger Device's IP-change report is accepted.
- **FR-002**: System MUST record an Application Log entry for every Action execution attempt, including its outcome (success or failure).
- **FR-003**: System MUST record an Application Log entry for errors encountered while processing a trigger event or executing an Action.
- **FR-004**: Every Application Log entry produced as a result of a given trigger event MUST carry a shared correlation identifier, so all entries belonging to one operation can be retrieved and reconstructed as a single sequence after the fact. A manually re-run Action execution is its own operation for this purpose: its entries carry a correlation identifier rooted at the manual request itself, not the identifier of the original trigger event being retried.
- **FR-005**: An Application Log entry for a failed Action execution MUST include enough detail (the Action and Trigger Device/account involved, and the failure reason) to diagnose the failure without consulting another system.
- **FR-006**: System MUST maintain an Access Log that records an entry for every incoming HTTP request to the backend — including, at minimum, the method, path, outcome status, timing, and the caller's source IP address — independent of whether that request produces any Application Log entry.
- **FR-007**: An Access Log entry MUST be recorded even for requests rejected before reaching authenticated application logic (e.g., failed authentication, malformed requests).
- **FR-008**: Application Log and Access Log MUST be two distinct output streams: no entry produced for one is ever recorded as part of the other, and each stream continues operating if the other's destination is unavailable.
- **FR-009**: Neither the Application Log nor the Access Log MUST ever contain a secret value (e.g., a Provider Credential's token, a Trigger Device's reporting credential, an authentication token) in plaintext.
- **FR-010**: A failure to write a log entry, in either stream, MUST NOT cause the underlying HTTP request or Action execution to fail.
- **FR-011**: Application Log and Access Log entry recording MUST NOT cause the existing trigger-ingestion endpoint's performance target (001-ip-change-automation SC-002: acknowledging an IP-change report in under 200ms p95) to regress.

### Key Entities

- **Application Log Entry**: A record of one occurrence of application activity — a trigger event being received, an Action execution attempt (with its outcome), or an error. Carries a correlation identifier linking it to the specific operation it belongs to, and enough detail to diagnose that occurrence on its own.
- **Access Log Entry**: A record of one incoming HTTP request to the backend — independent of what, if anything, the application decided to do with it. Carries request-level information (method, path, outcome status, timing, caller's source IP address) without depending on application-level context.
- **Operation**: The logical unit an operator traces — one trigger event and everything that happened because of it (the Application Log entries it produced). Not a new stored entity; a way of reading related Application Log entries together via their shared correlation identifier.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given the correlation identifier for any single operation, an operator can retrieve every Application Log entry belonging to it and reconstruct its full sequence — trigger received, every Action executed, final outcome(s) — using only the Application Log.
- **SC-002**: 100% of incoming HTTP requests to the backend produce exactly one corresponding Access Log entry, regardless of whether the request succeeds, fails, or is rejected before authentication.
- **SC-003**: Zero Application Log entries ever appear in the Access Log, and zero Access Log entries ever appear in the Application Log, across all observed activity.
- **SC-004**: Zero instances of a plaintext secret value appearing in either log stream, across all observed activity.
- **SC-005**: An operator can identify the reason for a failed Action execution using only its Application Log entry, without additional investigation, in at least 90% of failure cases.
- **SC-006**: A failure or unavailability of one log stream's destination never causes a business request or Action execution to fail, and never interrupts the other log stream.
- **SC-007**: The trigger-ingestion endpoint continues to acknowledge an IP-change report in under 200ms p95 (001-ip-change-automation SC-002) with logging enabled — i.e., logging adds no measurable regression to that existing target.

## Assumptions

- This feature extends the core FluxIP specification (001-ip-change-automation): its existing "Execution Record" (the user-facing history of Action outcomes shown in-app) remains unchanged; this addendum adds an operational/technical log layer for operators, distinct from that end-user-facing history, though both ultimately describe overlapping activity.
- The correlation identifier used to tie an operation's Application Log entries together is the identifier of its originating cause — the specific confirmed IP-change for automatic executions, or the manual request itself for a manually re-run execution — matching the core specification's existing `causationEventId` distinction between `ip_change`- and `manual`-triggered executions exactly, so this feature requires no change to that existing model.
- No specific logging tool, log format, storage backend, or output destination (console, file, external log service) is decided by this specification, per the stated non-goal — that is a planning-phase decision, free to change later without affecting the requirements here.
- No specific log retention period is defined in this iteration; retention policy is left to deployment configuration, consistent with not dictating an output destination.
- The Access Log's authenticated-context field (e.g., which account made a request), where available, does not itself count as a "secret value" under FR-009 — only credential/token material is excluded from log entries.
- "Operator" in this specification refers to whoever operates and maintains the deployment (e.g., via infrastructure-level log access) — this feature does not require or imply any new in-application UI for viewing either log stream.
