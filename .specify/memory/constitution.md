<!--
Sync Impact Report
- Version change: (unratified template) → 1.0.0
- Modified principles: none (initial ratification)
- Added sections:
  - Core Principles: I. Explicit Commit Authorization
  - Governance
- Removed sections:
  - Principles II-V placeholders (not defined; no additional principles supplied at ratification time — see deferred items)
  - Optional Section 2 / Section 3 placeholders (no additional constraints or workflow rules supplied beyond Governance)
- Templates requiring updates:
  - ✅ .specify/templates/tasks-template.md (removed "Commit after each task or logical group" from Notes; replaced with a pointer to this constitution's commit-authorization principle)
  - ✅ .specify/templates/plan-template.md (Constitution Check gate references this file generically; no changes needed)
  - ✅ .specify/templates/spec-template.md (no commit/process references; no changes needed)
  - ✅ .claude/skills/speckit-*/SKILL.md (only generic `speckit.git.commit` → `/speckit-git-commit` naming examples; no auto-commit instructions found; no changes needed)
  - ✅ README.md (release-pipeline references to Conventional Commits are consistent with this principle; no changes needed)
- Follow-up TODOs:
  - TODO(ADDITIONAL_PRINCIPLES): This constitution currently defines only the commit-authorization principle, since that is the only governance rule supplied so far. Add further principles (e.g. testing discipline, architecture constraints) as they are decided.
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

**Version**: 1.0.0 | **Ratified**: 2026-07-23 | **Last Amended**: 2026-07-23
