# Implementation Plan: Automated Docker Release Pipeline

**Branch**: `002-docker-release-pipeline` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-docker-release-pipeline/spec.md`

## Summary

A single GitHub Actions workflow triggers on every push to `main`. It builds and tests the project (host-level `pnpm` build/test, unchanged from today), builds **one** multi-stage Docker image from a new repo-root `Dockerfile` containing both the backend's compiled output and the frontend's static build output, and smoke-tests both runtime roles from that same built image (`node backend/dist/main.js` for the backend, a lightweight static file server for the frontend) before anything is allowed to publish. It then uses `semantic-release`'s commit-analyzer (dry-run, `conventionalcommits` preset) to compute the next SemVer version. If a version is warranted, the already-built image is pushed to GHCR tagged with that version and `latest`; only once that push succeeds is a matching Git tag/GitHub Release created. `docker-compose.yml`'s `app` and `frontend` services are updated to build from that same one Dockerfile, differing only in their `command:`.

## Technical Context

**Language/Version**: GitHub Actions workflow (YAML) + a small Node.js 22 script for version computation, consistent with the rest of the FluxIP monorepo's toolchain.

**Primary Dependencies**: `semantic-release` + `@semantic-release/commit-analyzer` + `conventional-changelog-conventionalcommits` (version computation only — semantic-release's own core creates Git tags *before* publish plugins run and never rolls back, which conflicts with this spec's confirmed publish-then-tag ordering, so it is used for commit analysis only, not orchestration; see research.md). `serve` (npm package) as the frontend runtime's static file server, replacing nginx so both runtime roles share one Node-based container. GitHub Actions marketplace actions: `actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `docker/build-push-action`, `docker/login-action`.

**Storage**: N/A (no new persistent application storage; reads Git tag history as the version source of truth).

**Testing**: Reuses `pnpm -r build` and `pnpm --filter fluxip-backend test` (real Postgres+Redis integration tests) as before, plus a new lightweight per-role Docker smoke test (confirmed via `/speckit-clarify`) that is *not* a full test-suite run against the container.

**Target Platform**: GitHub-hosted Actions runner (`ubuntu-latest`); publishes to GitHub Container Registry (GHCR); the one image is meant to run on any Docker-compatible host, selecting its role via start command.

**Project Type**: Web application (existing `backend/` + `frontend/` structure) — this feature adds CI/CD automation and consolidates image packaging; it changes how the two existing apps are containerized, not their application code.

**Performance Goals**: N/A (no user-facing runtime performance target).

**Constraints**: Must not publish anything (image, version tag, Git tag, release) on build/test failure or on a smoke-test failure for either role (FR-006); Git tag must never exist without its matching image already published (FR-014); exactly one image, never two, per Release (FR-002).

**Scale/Scope**: Single repository, single `main` branch, one Docker image containing two runtime roles.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` contains only unfilled template placeholders — no project constitution has been established. No gates apply. This plan follows the same pragmatic, minimal-abstraction approach established elsewhere in this project: reusing pnpm's native workspace install (copying the whole monorepo dependency tree into the final image) rather than introducing `pnpm deploy`'s package-pruning machinery, since the whole point of this feature is *one* combined image — there's no lean single-package artifact to prune toward.

**Post-design re-check**: Phase 1 design introduces one new small runtime dependency (`serve`, replacing nginx) and one new root-level `Dockerfile` replacing the two existing per-workspace ones; no new services, no new orchestration abstractions. Still no gates to fail.

## Project Structure

### Documentation (this feature)

```text
specs/002-docker-release-pipeline/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/            # Phase 1 output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
Dockerfile                      # NEW: single multi-stage build producing one image with
                                 # both backend/dist and frontend/dist inside it; no role-
                                 # specific CMD baked in — the role is chosen entirely via
                                 # the `command:` a caller supplies at container-start time

backend/Dockerfile               # REMOVED — superseded by the root Dockerfile
frontend/Dockerfile              # REMOVED — superseded by the root Dockerfile

docker-compose.yml               # MODIFIED: `app` and `frontend` services both build from
                                 # the root Dockerfile (same context/dockerfile), differing
                                 # only in their `command:` (backend start vs. frontend start)

frontend/package.json            # MODIFIED: add `serve` as a runtime dependency (replaces
                                 # nginx as the frontend's static file server so both roles
                                 # share one Node-based runtime image)

.github/
├── workflows/
│   └── release.yml              # Single workflow/job: build → test → docker build →
│                                 # smoke-test both roles → determine version → push → tag/release
└── scripts/
    └── determine-version.mjs    # Runs semantic-release in dry-run mode, emits
                                  # should-release/version/git-tag to $GITHUB_OUTPUT

.releaserc.json                  # semantic-release config: conventionalcommits preset,
                                  # commit-analyzer only (no publish/git/github plugins)

package.json                     # Root: add semantic-release + @semantic-release/commit-analyzer +
                                  # conventional-changelog-conventionalcommits as devDependencies
```

**Structure Decision**: The two existing per-workspace Dockerfiles are replaced by one root-level `Dockerfile` (build context = repo root, so it can see both `backend/` and `frontend/`), since a single combined image structurally requires a single build context spanning both. `docker-compose.yml`'s two existing services (`app`, `frontend`) are kept as-is conceptually (still two services, still two running containers for local dev) but now both point at the same image build, differentiated only by `command:` — directly satisfying FR-004 without adding new services.

## Complexity Tracking

*No constitution violations to justify — this section is intentionally empty.*
