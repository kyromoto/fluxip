<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0
- Modified principles: none
- Added sections:
  - Core Principles: II. Twelve-Factor Compliance
- Removed sections: none
- Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (Constitution Check gate references this file generically; the new principle is picked up automatically; no changes needed)
  - ✅ .specify/templates/spec-template.md (no changes needed)
  - ✅ .specify/templates/tasks-template.md (no changes needed)
  - ✅ docs/12-factor-backlog.md (referenced by the new principle as the register of known deviations)
- Follow-up TODOs:
  - TODO(ADDITIONAL_PRINCIPLES): Add further principles (e.g. testing discipline, architecture constraints) as they are decided.

Previous report (1.0.0, 2026-07-23): initial ratification with Principle I
(Explicit Commit Authorization) and Governance.
-->

# FluxIP Constitution

## Core Principles

### I. Explicit Commit Authorization

Git commits MUST NOT be created automatically upon completing a task, a
feature, or any other unit of work. A commit MUST only be created when the
user explicitly instructs it.

When a commit is requested, the assistant MUST first inspect the current
diff and the project's recent commit history (e.g. `git log --oneline -10`)
to identify the project's existing commit-message style, then compose a
commit message that follows the Conventional Commits convention (`feat:`,
`fix:`, `chore:`, `refactor:`, `docs:`, etc.) derived from that diff and
style — rather than asking the user to dictate the wording.

**Rationale**: Automatic commits create an unreviewable, unintentional
history and risk committing incomplete or exploratory work. Requiring an
explicit request keeps the commit history deliberate. Deriving the message
from the actual diff and prior style — instead of prompting the user for
wording — keeps the workflow low-friction while still producing consistent,
convention-following history.

### II. Twelve-Factor Compliance

New and changed code MUST comply with the Twelve-Factor App criteria
(https://12factor.net). Concretely:

- **Config**: Configuration MUST come only from environment variables and
  MUST be validated at startup. Production code paths MUST NOT carry
  development defaults for secrets or hosts.
- **Backing services**: Postgres, Redis, SMTP, Logto and similar services
  MUST be attached only via URLs or host/port values from the environment
  and MUST be replaceable without code changes.
- **Logs**: Logs MUST be written as an event stream to stdout. The
  application MUST NOT write or rotate log files itself.
- **Processes**: Processes MUST be stateless; shared state lives only in
  Postgres or Redis. Process-local caches are allowed only if they can be
  rebuilt without loss.
- **Port binding and concurrency**: The application MUST bind its own ports
  (configurable via the environment), and process types (web, worker) MUST
  be separable and independently scalable.
- **Disposability**: Startup MUST be fast. On SIGTERM the application MUST
  shut down gracefully (close the HTTP server, queues and connections)
  within a bounded timeout.
- **Build, release, run**: Stages MUST be strictly separated. Dependencies,
  base images and CI actions MUST be pinned, and the same image MUST run in
  every environment.
- **Admin processes**: Tasks such as database migrations MUST run as
  one-off processes, not implicitly at web process start.
- **Dev/prod parity**: Development, test and production MUST use the same
  kinds of backing services.

Existing known deviations are tracked in `docs/12-factor-backlog.md`. New
work MUST NOT worsen them; fixing them is done as separate features. The
"Constitution Check" in every plan MUST verify this principle, and any
justified violation MUST be recorded in the plan's Complexity Tracking.

**Rationale**: The application is deployed as container images behind a
reverse proxy and has to run in several environments and, eventually, as
several replicas. The twelve-factor rules keep configuration, state, logging
and operations compatible with that, and a checked backlog stops the
existing deviations from growing.

## Governance

This constitution supersedes all other informal practices or ad hoc
instructions when they conflict with a ratified principle. Amendments are
made by editing this file directly: propose the change, update the
Sync Impact Report at the top of this file, bump `CONSTITUTION_VERSION`
according to semantic versioning (MAJOR for backward-incompatible
principle removals/redefinitions, MINOR for new principles or materially
expanded guidance, PATCH for clarifications and wording fixes), and update
`Last Amended` to the date of the change.

Any Spec Kit artifact (spec, plan, tasks, or template) that conflicts with
a ratified principle MUST be updated in the same change that introduces or
amends the principle — see the Sync Impact Report above for the templates
already checked as part of this ratification.

Compliance with this constitution is expected in every session; when
guidance here and an ad hoc request conflict, this file governs unless the
user explicitly overrides it for that instance.

**Version**: 1.1.0 | **Ratified**: 2026-07-23 | **Last Amended**: 2026-10-29
