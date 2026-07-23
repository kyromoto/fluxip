---

description: "Task list for Automated Docker Release Pipeline"
---

# Tasks: Automated Docker Release Pipeline

**Input**: Design documents from `/specs/002-docker-release-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not explicitly requested in spec.md, so no dedicated automated-test-writing tasks are included. Each user-story phase ends with a "Run quickstart.md Scenario N" task instead, which is that story's independent-test checkpoint.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P1/P2) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- File paths are relative to the repository root

## Path Conventions

This feature replaces the two existing per-workspace Dockerfiles with one root-level `Dockerfile`, updates `docker-compose.yml`, and adds CI/CD automation under `.github/`. No `backend/src/`/`frontend/src/` application code changes (plan.md's Structure Decision) besides adding `serve` as a frontend runtime dependency.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Version-determination tooling and workflow scaffolding

- [X] T001 [P] Add `semantic-release`, `@semantic-release/commit-analyzer`, and `conventional-changelog-conventionalcommits` as root devDependencies (`package.json`, updating `pnpm-lock.yaml` via `pnpm install`) per research.md §1/§3
- [X] T002 [P] Create `.releaserc.json` at the repo root configuring `@semantic-release/commit-analyzer` with the `conventionalcommits` preset and no other plugins (research.md §2/§3)
- [X] T003 [P] Add `serve` as a runtime dependency in `frontend/package.json` (updating `pnpm-lock.yaml`), replacing nginx as the frontend's static file server (research.md §6)
- [X] T004 [P] Create the workflow skeleton at `.github/workflows/release.yml`: `name`, `on: push: branches: [main]`, top-level `permissions: { contents: write, packages: write }` (contracts/release-workflow.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single combined image and the pipeline's build/test gate — every user story depends on both existing

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 [P] Create the root-level `Dockerfile`: multi-stage build with a build stage that runs `pnpm install` (all workspaces) and `pnpm -r build`, and a runtime stage that copies both `backend/dist` + its production `node_modules` and `frontend/dist` + its production `node_modules` (including `serve` from T003) into one final image — no default role-specific `CMD` baked in (research.md §5/§7, data-model.md's Docker Image entity)
- [X] T006 Remove `backend/Dockerfile` and `frontend/Dockerfile` (depends on T005 existing and building successfully) — superseded by the root Dockerfile (plan.md's Structure Decision)
- [X] T007 [P] Add the job's checkout/setup/build/test steps to `.github/workflows/release.yml` (depends on T004): `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` (Node 22), `pnpm install --frozen-lockfile`, Postgres (`postgres:16-alpine`) + Redis (`redis:7-alpine`) service containers, `pnpm -r build`, then `pnpm --filter fluxip-backend test` with required env vars (`DATABASE_URL`, `REDIS_URL`, `CLOUDEVENTS_SOURCE`, `CLOUDEVENTS_TYPE_PREFIX`, `LOGTO_ENDPOINT`, `CREDENTIAL_ENCRYPTION_KEY`) matching `backend/src/config/env.ts`
- [X] T008 Add the Docker build step to `.github/workflows/release.yml` (depends on T005, T006, T007): build the root `Dockerfile`, `push: false`, `load: true` (loads into the runner's local Docker daemon, tagged e.g. `fluxip:ci`, not yet pushed to GHCR — research.md §9)

**Checkpoint**: The pipeline checks out, installs, builds, tests, and builds one local Docker image successfully — nothing published yet. Ready for user story work.

---

## Phase 3: User Story 1 - Ship a new version without touching a version number by hand (Priority: P1) 🎯 MVP

**Goal**: A qualifying commit pushed to `main` results in an automatically-determined version, the single Docker image published to GHCR tagged with that version and `latest`, and a matching Git tag/GitHub Release — with no manual steps.

**Independent Test**: Run quickstart.md Scenario 1 — seed the one-time `v0.1.0` baseline tag, push a `fix:`/`feat:`/`feat!:` commit, and confirm the version, the one GHCR image tag, and the Git tag/release all match.

### Implementation for User Story 1

- [X] T009 [P] [US1] Create the version-determination script at `.github/scripts/determine-version.mjs`: invoke `semantic-release`'s Node API with `{ dryRun: true }` (using `.releaserc.json`'s config from T002), and write `should-release`, `version` (bare SemVer), and `git-tag` (`v${version}`) to `$GITHUB_OUTPUT` per contracts/release-workflow.md's `determine-version` step contract — exits `0` in both the release and no-release case
- [X] T010 [US1] Change the checkout step added in T007 to use `fetch-depth: 0` (full history + tags — required so T009's script can see prior release tags, contracts/release-workflow.md)
- [X] T011 [US1] Add the determine-version step to `.github/workflows/release.yml` (depends on T008, T009, T010): run `node .github/scripts/determine-version.mjs` with an `id` so downstream steps can reference `steps.version.outputs.*`
- [X] T012 [US1] Add the GHCR login step to `.github/workflows/release.yml` (depends on T011): `docker/login-action` against `ghcr.io` using `github.actor`/`secrets.GITHUB_TOKEN`, gated on `if: steps.version.outputs.should-release == 'true'`
- [X] T013 [US1] Add the image push step to `.github/workflows/release.yml` (depends on T012): push the already-built local image (from T008) to `ghcr.io/${{ github.repository_owner }}/fluxip` tagged `${{ steps.version.outputs.version }}` and `latest`, gated on `should-release`
- [X] T014 [US1] Add the Git tag + GitHub Release creation step to `.github/workflows/release.yml` (depends on T013): using `steps.version.outputs.git-tag`/`version`, gated on `should-release` — this step MUST be the last step in the job so it only runs after T013 has already succeeded (contracts/release-workflow.md, FR-014's confirmed ordering)
- [X] T015 [US1] Run quickstart.md Scenario 1 end-to-end and fix any gaps found — seed the one-time `v0.1.0` baseline tag first (FR-008), then push `fix:`/`feat:`/`feat!:` commits and confirm the resulting version, the single GHCR image tag (both versioned and `latest`), and Git tag/Release all match

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP (though FR-006's full gating on smoke tests isn't wired in until User Story 2/3).

---

## Phase 4: User Story 2 - One image, two runtime roles (Priority: P1)

**Goal**: The single published image can run either the backend or the frontend, chosen entirely by the container's start command; `docker-compose.yml` demonstrates this with two services built from that one image.

**Independent Test**: Run quickstart.md Scenario 2 — start two containers from the same image with different start commands and confirm both roles work; run `docker compose up` and confirm both services start from the one image.

### Implementation for User Story 2

- [X] T016 [P] [US2] Update `docker-compose.yml`: both the `app` and `frontend` services now `build: { context: ., dockerfile: Dockerfile }` (the root Dockerfile from T005) instead of their old per-workspace contexts, each with its own `command:` override — `app`: `["node", "backend/dist/main.js"]`; `frontend`: `["serve", "-s", "frontend/dist", "-l", "3000"]` (research.md §10, contracts/release-workflow.md's Runtime contract)
- [X] T017 [US2] Add the backend smoke-test step to `.github/workflows/release.yml` (depends on T008): `docker run --rm -d --network host -e DATABASE_URL=postgresql://fluxip:fluxip@localhost:5432/fluxip -e REDIS_URL=redis://localhost:6379 -e CLOUDEVENTS_SOURCE=https://fluxip.example.com -e CLOUDEVENTS_TYPE_PREFIX=space.kyro.fluxip -e LOGTO_ENDPOINT=https://smoke-test.invalid -e CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)` the T008-built local image with the backend start command, poll `http://localhost:8080/metrics` for `200` within a 15s bounded timeout, then stop the container — failure fails the job. `DATABASE_URL`/`REDIS_URL` reuse T007's real Postgres/Redis service containers (`loadConfig()` validates their presence and migrations run before the port opens); `CLOUDEVENTS_SOURCE`/`CLOUDEVENTS_TYPE_PREFIX`/`LOGTO_ENDPOINT`/`CREDENTIAL_ENCRYPTION_KEY` are well-formed dummy values since nothing at startup actually contacts Logto or validates the CloudEvents source — only presence/format is checked (contracts/release-workflow.md's Docker build + smoke test contract, research.md §8)
- [X] T018 [US2] Add the frontend smoke-test step to `.github/workflows/release.yml` (depends on T017): same pattern using the frontend start command, poll `http://localhost:3000/` for `200`, then stop the container
- [X] T019 [US2] Tighten the image push step (T013) in `.github/workflows/release.yml` so it's gated on `should-release` AND both T017 and T018 having succeeded, not just `should-release` alone (FR-005a/FR-006)
- [X] T020 [US2] Run quickstart.md Scenario 2 end-to-end and fix any gaps found — `docker run` the published image with each start command and confirm both roles work with no rebuild/pull; run `docker compose up` and confirm both services start correctly from the one image

**Checkpoint**: User Stories 1 AND 2 both work — the released image genuinely serves both roles, and publishing is now correctly gated on both roles actually working.

---

## Phase 5: User Story 3 - Broken code never reaches a published release (Priority: P1)

**Goal**: A push that fails the build, tests, the Docker build, or either role's smoke test stops the pipeline before anything is published.

**Independent Test**: Run quickstart.md Scenario 3 — break a test, and separately break only one start command while leaving the other working; confirm nothing publishes in either case.

### Implementation for User Story 3

- [X] T021 [US3] In `.github/workflows/release.yml`, confirm and document (via a short comment above the push step) that the default GitHub Actions step-failure behavior is what enforces FR-006: a failure in the build/test step (T007), the Docker build (T008), or either smoke test (T017/T018) stops the job before the push/tag steps (T013/T014) ever run. Confirm no step in the job sets `continue-on-error: true`.
- [X] T022 [US3] Run quickstart.md Scenario 3 end-to-end and fix any gaps found — push a commit that breaks `pnpm --filter fluxip-backend test`, confirm nothing publishes; separately push a commit that breaks only the frontend's start command (e.g. an invalid `serve` path) while the backend still works, and confirm the frontend smoke test fails and nothing publishes even though the backend role would have been fine

**Checkpoint**: User Stories 1, 2, AND 3 all work independently.

---

## Phase 6: User Story 4 - Routine changes that don't warrant a release stay silent (Priority: P2)

**Goal**: A push with no version-qualifying commit since the last release completes successfully (build, test, and both smoke tests still run and pass) without publishing anything new.

**Independent Test**: Run quickstart.md Scenario 4 — push a `chore:`/non-conventional commit with no other qualifying commit since the last release, and confirm the workflow succeeds with nothing new published.

### Implementation for User Story 4

- [X] T023 [US4] Verify `.github/scripts/determine-version.mjs` (from T009) exits `0` with `should-release=false` (not a failure) when semantic-release's dry-run reports no release is warranted, and that the push/tag steps' `if: steps.version.outputs.should-release == 'true'` conditions correctly skip (shown as "skipped", not "failed") in that case — while the build/test/Docker-build/smoke-test steps still ran and passed (FR-001 is unconditional)
- [X] T024 [US4] Run quickstart.md Scenario 4 end-to-end and fix any gaps found — push a `chore:` commit and, separately, a commit with no Conventional Commits prefix at all, and confirm both result in a successful (green) workflow run with no new image tag, Git tag, or Release

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Guarantees that cut across all user stories, plus documentation

- [X] T025 [P] Run quickstart.md Scenario 5 (publish-order guarantee under simulated partial failure) and confirm no Git tag/Release is created when the image push fails after version determination and both smoke tests succeed (FR-014)
- [X] T026 [P] Validate idempotency (FR-017): re-run the `release` workflow (e.g. GitHub's "Re-run all jobs") for a `main` state that already has a matching Git tag, and confirm `should-release` reports `false` on the re-run with no duplicate/conflicting tag, Release, or image-tag error
- [X] T027 [P] Document the release process in `README.md`: Conventional Commits prefix reference (`feat:`→minor, `fix:`→patch, `feat!:`/`BREAKING CHANGE`→major), the one-image/two-roles model (how to run the backend vs. frontend from the published image, referencing the updated `docker-compose.yml`), where published images/tags/Releases can be found, and the one-time `v0.1.0` baseline-tag setup step from quickstart.md
- [X] T028 [P] Security review of `.github/workflows/release.yml`: confirm the `permissions` block grants only `contents: write` and `packages: write`, no step logs `secrets.GITHUB_TOKEN` or any other credential, and the smoke-test containers (T017/T018) use only dummy/service-container values, never production secrets

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup (T004's workflow skeleton, T003's `serve` dependency) — BLOCKS all user stories, since there is no image to version (US1), demonstrate two roles from (US2), gate publishing of (US3), or skip-publishing of (US4) without it
- **User Story 1 (Phase 3)**: Depends on Foundational only
- **User Story 2 (Phase 4)**: Depends on Foundational and on User Story 1's push step (T013) existing, since it tightens that step's gating condition — independently testable via its own quickstart scenario
- **User Story 3 (Phase 5)**: Depends on User Story 2 (its smoke-test steps are part of what US3 verifies actually gates publishing) — independently testable via its own quickstart scenario
- **User Story 4 (Phase 6)**: Depends on User Story 1's determine-version step (T009, T011) — independently testable via its own quickstart scenario
- **Polish (Phase 7)**: Depends on all four user stories being complete

### Within Each User Story

- Script/config before workflow steps that invoke them
- Steps within `.github/workflows/release.yml` are added in their actual execution order, since GitHub Actions steps in one job execute sequentially and later steps in this feature depend on earlier ones' outputs
- Story complete before moving to the next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T001-T004 — four different files)
- T005 (new Dockerfile) and T007 (workflow build/test steps) can be developed in parallel (different files); T006 (removing old Dockerfiles) should follow T005
- T009 (a new script file) can be developed in parallel with other Phase 3 work up until T011 wires it in
- T016 (docker-compose.yml) is a different file from `.github/workflows/release.yml` and can be done in parallel with T017-T019
- All Phase 7 Polish tasks marked [P] can run in parallel once all four user stories are complete
- Tasks editing `.github/workflows/release.yml` within a phase are otherwise sequential (same-file edits)

---

## Parallel Example: Setup

```bash
# Launch all Setup tasks together (different files, no dependencies):
Task: "Add semantic-release devDependencies in package.json"
Task: "Create .releaserc.json"
Task: "Add serve as a runtime dependency in frontend/package.json"
Task: "Create the workflow skeleton at .github/workflows/release.yml"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — the one combined image and the build/test gate)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run quickstart.md Scenario 1 independently
5. This ships automatic versioned releases of the one combined image — though full FR-006 gating (both roles' smoke tests) isn't wired in until User Story 2, so treat this checkpoint as "versioning works," not yet "fully safe to auto-publish."

### Incremental Delivery

1. Setup + Foundational → one combined image builds and the project's tests pass in CI
2. Add User Story 1 → validate via Scenario 1 → the pipeline ships versioned releases (MVP!)
3. Add User Story 2 → validate via Scenario 2 → the image's two-roles contract is proven and now gates publishing
4. Add User Story 3 → validate via Scenario 3 → the safety guarantee is explicitly confirmed
5. Add User Story 4 → validate via Scenario 4 → the no-noise guarantee is explicitly confirmed
6. Polish → validate Scenario 5 (partial-failure ordering) and FR-017 (idempotency); document the process

### Parallel Team Strategy

Given this feature centers on one Dockerfile and one workflow YAML file, most of Phases 2-6 are inherently sequential (same-file edits building up one pipeline). The realistic parallelism is: one person on T001-T004 (Setup) while another starts T005 (the Dockerfile, no overlap with the workflow YAML) — after which the remaining step-by-step assembly of `.github/workflows/release.yml` (T007-T014, T017-T019) is most safely done by one person/session to avoid merge conflicts in a single YAML file.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- This feature replaces `backend/Dockerfile` and `frontend/Dockerfile` with one root `Dockerfile`, updates `docker-compose.yml`, and adds `.github/workflows/`, `.github/scripts/`, `.releaserc.json`, and root/`frontend` `package.json` changes (plan.md's Structure Decision) — no other application code changes
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
