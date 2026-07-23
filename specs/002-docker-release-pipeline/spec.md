# Feature Specification: Automated Docker Release Pipeline

**Feature Branch**: `002-docker-release-pipeline`

**Created**: 2026-07-23

**Status**: Draft

**Input**: User description: "FluxIP benötigt eine automatisierte CI/CD-Pipeline via GitHub Actions, die bei Codeänderungen ein Docker-Image baut und veröffentlicht, sowie die Versionsvergabe des Projekts eigenständig übernimmt. Bei Push auf `main` wird automatisch genau EIN Docker-Image gebaut, das sowohl Backend- als auch Frontend-Code/-Artefakte enthält (Monorepo, aber ein gemeinsames Image). Welcher Teil läuft, wird zur Laufzeit über den Start-Command des jeweiligen Containers bestimmt, nicht über separate Images. In docker-compose werden zwei Services aus diesem einen Image definiert, jeweils mit eigenem Start-Command. Das Image wird in GHCR veröffentlicht, mit SemVer-Version (automatisch aus Conventional-Commits-Präfixen bestimmt) plus `latest` getaggt. Ein passendes Git-Tag/Release wird angelegt, sodass Version im Git-Verlauf und im Image immer übereinstimmen. Fehlgeschlagene Builds/Tests verhindern die Veröffentlichung. Commits ohne erkennbaren Präfix lösen keine neue Version aus. Nur eine SemVer-Version pro Release, kein separates Versionieren von Backend und Frontend."

## Clarifications

### Session 2026-07-23

- Q: How thorough should the pipeline's verification be that both the backend and frontend start commands actually work from the built image before publishing? → A: Lightweight smoke test — briefly start a container per role, confirm it comes up correctly, then stop; separate from (and in addition to) the existing host-level build/test suite. Not a full test-suite run against the containerized image itself.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ship a new version without touching a version number by hand (Priority: P1)

A maintainer merges a change into `main` whose commits follow the Conventional Commits convention (e.g. a `fix:` commit). Without anyone editing a version file, running a release command, or creating a tag manually, the next version number is determined automatically, one Docker image is built and published to GHCR tagged with that version, and a matching Git tag/release is created — so the version in the Git history and the version on the published image are always the same number.

**Why this priority**: This is the entire point of the feature — eliminating manual version bookkeeping and manual image publishing is the core value proposition. Nothing else in this spec matters if this doesn't work.

**Independent Test**: Push a commit with a `fix:` prefix to `main` on a repository that already has a prior released version, and confirm: (a) the version number increases by a patch increment, (b) exactly one Docker image tagged with the new version appears in GHCR, (c) the `latest` tag in GHCR points at the same image, (d) a Git tag/release matching the version number exists in the repository.

**Acceptance Scenarios**:

1. **Given** the last released version was `1.2.3` and the only new commit on `main` since then is prefixed `fix:`, **When** the commit is pushed, **Then** the pipeline determines the new version as `1.2.4`, publishes one GHCR image tagged `1.2.4` and `latest`, and creates a matching Git tag/release `1.2.4`.
2. **Given** the last released version was `1.2.3` and the only new commit on `main` since then is prefixed `feat:`, **When** the commit is pushed, **Then** the new version is `1.3.0`.
3. **Given** the last released version was `1.2.3` and a new commit on `main` is prefixed `feat!:` (or its body contains `BREAKING CHANGE`), **When** the commit is pushed, **Then** the new version is `2.0.0`.

---

### User Story 2 - One image, two runtime roles (Priority: P1)

Someone deploying FluxIP (or a maintainer testing a release locally) works with a single published Docker image per version, yet can run either the backend server or the frontend server from it, simply by giving the container a different start command. The project's `docker-compose` configuration demonstrates this directly: two services, one image, two start commands.

**Why this priority**: This is a structural requirement of the release artifact itself, not an optional nicety — every other story in this spec (versioning, publishing, gating) is about *when* and *how* a release happens, but this story defines *what* gets released. Getting this wrong (e.g. accidentally building two images, or requiring a rebuild to switch roles) undermines the "one image, one version" premise the rest of the spec depends on.

**Independent Test**: Build the image locally (or pull a published version-tagged image from GHCR) and start two containers from it with different start commands — one for the backend, one for the frontend — and confirm both run correctly without any rebuild or image variant switch. Separately, run `docker compose up` against the project's compose configuration and confirm both the backend and frontend services start successfully, each sourced from the same image.

**Acceptance Scenarios**:

1. **Given** a published (or locally built) version-tagged image, **When** a container is started from it using the backend's start command, **Then** the backend server runs correctly.
2. **Given** the same image, **When** a container is started from it using the frontend's start command instead, **Then** the frontend server runs correctly — with no separate image build or pull required.
3. **Given** the project's `docker-compose` configuration, **When** it is brought up, **Then** it defines exactly two services that both reference the single image, differing only in their start command.

---

### User Story 3 - Broken code never reaches a published release (Priority: P1)

A maintainer pushes a change to `main` that fails the project's automated build or test suite, or that fails the post-build smoke test for either the backend or the frontend Container Role. The pipeline stops before anything is published: no new Docker image is pushed to GHCR (neither a version-tagged nor an updated `latest` image), no version is determined, and no Git tag/release is created. The last known-good published image and release remain exactly as they were.

**Why this priority**: Without this guarantee, the automation in User Story 1 becomes actively dangerous — a broken image could be published and mistaken for a working release. This is a correctness/safety requirement of equal priority to the happy path.

**Independent Test**: Push a commit to `main` that breaks the build, fails a test, or breaks either the backend or frontend start command (causing its smoke test to fail), and confirm no new image, image tag, Git tag, or release was created, while the previously published `latest`/version-tagged image is unchanged.

**Acceptance Scenarios**:

1. **Given** the project's test suite currently passes, **When** a commit that breaks a test is pushed to `main`, **Then** the pipeline fails, no Docker image is published, and no new version or Git tag is created.
2. **Given** the project's Docker image currently builds and runs both start commands successfully, **When** a commit breaks the image build itself, **Then** the pipeline fails before any publishing step runs.
3. **Given** the image otherwise builds successfully, **When** a commit breaks only the frontend's start command (e.g. missing bundled assets) so its smoke test (FR-005a) fails while the backend's smoke test still passes, **Then** the pipeline still fails and nothing is published — a partially-working image is treated the same as a fully broken one.

---

### User Story 4 - Routine changes that don't warrant a release stay silent (Priority: P2)

A maintainer pushes a commit to `main` whose message doesn't use a recognized Conventional Commits prefix (e.g. a documentation tweak, a chore, or a message that doesn't follow the convention at all). The pipeline does not invent a version bump, does not create a Git tag or release, and does not publish a new version-numbered image for that change.

**Why this priority**: This prevents version-number noise (a new "release" for every trivial commit) and is explicitly required, but it's secondary to the P1 behaviors — the pipeline is still useful even if this exact edge case needs a follow-up fix, whereas it is not useful if the P1 stories are broken.

**Independent Test**: Push a commit to `main` with a message that has no recognizable Conventional Commits prefix, and confirm the previously released version number is unchanged and no new Git tag/release was created.

**Acceptance Scenarios**:

1. **Given** the last released version was `1.2.3`, **When** a commit prefixed `chore:` (a type that does not map to a version bump) is pushed to `main` with no other qualifying commits since the last release, **Then** no new version, Git tag, or release is created.
2. **Given** the last released version was `1.2.3`, **When** a commit with a message that doesn't follow Conventional Commits at all (e.g. `"fixed stuff"`) is pushed to `main` with no other qualifying commits since the last release, **Then** no new version, Git tag, or release is created.

---

### Edge Cases

- What happens when a push to `main` brings in several commits at once (e.g. a merge) with different Conventional Commit types? The highest-precedence bump across all new commits since the last release wins (major > minor > patch) — a single `fix:` alongside a `feat:` still results in a minor bump, not two separate releases.
- What happens if the pipeline is re-run (e.g. manually retried) after a version has already been published for the current `main` state? It must not create a duplicate or conflicting Git tag/release, and must not attempt to republish an image under a version tag that already exists.
- What happens on the very first run, when no prior version tag exists in the repository at all? See Assumptions for the starting version number.
- What happens if a qualifying commit (`fix:`/`feat:`/breaking) is pushed together with non-qualifying commits (e.g. `chore:`) in the same push? Only the qualifying commit(s) determine the version bump; the non-qualifying ones don't block or alter it.
- What happens if the Docker image publishes successfully but Git tag/release creation then fails? See Assumptions for the ordering guarantee this specification requires.
- What happens if the image builds successfully but only one of the two start commands (backend or frontend) actually works? Treated as a build/test failure (User Story 3, Scenario 3) — both start commands are smoke-tested (FR-005a) before anything publishes, since the whole point of one shared image is that either role must be runnable from it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST automatically build a Docker image whenever commits are pushed to the `main` branch.
- **FR-002**: The system MUST build exactly one Docker image per pipeline run, containing both the backend and frontend code/artifacts — never two separate images for the same release.
- **FR-003**: The system MUST determine which part of the application (backend or frontend) actually runs in a given container at container-start time, via that container's own start command — never by publishing a separate image per part.
- **FR-004**: The project's `docker-compose` configuration MUST define two services derived from the single published/built image, each with its own start command — one that runs the backend, one that runs the frontend.
- **FR-005**: The system MUST run the project's automated build and test suite as part of the pipeline before any publishing step.
- **FR-005a**: In addition to that existing build/test suite, the system MUST run a lightweight smoke test per Container Role after the image is built: briefly start a container using the backend's start command and confirm it comes up correctly, then do the same for the frontend's start command — each stopped afterward. This is not a full run of the existing test suite against the containerized image, only a startup check (confirmed via `/speckit-clarify`).
- **FR-006**: The system MUST NOT publish a Docker image, version tag, Git tag, or release if the build/test suite fails or if either Container Role's smoke test (FR-005a) fails.
- **FR-007**: The system MUST determine the next version number automatically, following Semantic Versioning (MAJOR.MINOR.PATCH), without a human manually editing a version number.
- **FR-008**: When no prior version tag exists in the repository, the system MUST treat `0.1.0` as the baseline version that the first qualifying commit's bump is applied to.
- **FR-009**: The system MUST derive the version bump from Conventional Commits prefixes found in the commits pushed to `main` since the last released version: a `fix:`-type commit produces a PATCH bump, a `feat:`-type commit produces a MINOR bump, and a commit marked as breaking (`feat!:`, `fix!:`, or a `BREAKING CHANGE` footer/body) produces a MAJOR bump.
- **FR-010**: When multiple qualifying commits with different bump types are included in the same push, the system MUST apply only the single highest-precedence bump (major over minor over patch) rather than multiple successive bumps.
- **FR-011**: The system MUST NOT determine a new version, create a Git tag, create a release, or publish a version-tagged image when none of the commits pushed to `main` since the last released version carry a recognized Conventional Commits prefix that maps to a version bump.
- **FR-012**: On a successful pipeline run that does determine a new version, the system MUST publish the single built Docker image to the GitHub Container Registry (GHCR) tagged with that exact version number.
- **FR-013**: The system MUST also update a `latest` tag in GHCR to point at the current `main` branch's published image whenever a new version is successfully released.
- **FR-014**: The system MUST create a Git tag (and/or GitHub Release) in the repository matching the determined version number, such that the version recorded in the Git history and the version tag on the published Docker image are always identical. The Docker image MUST be published successfully before the Git tag/release is created, so that a Git tag's existence always guarantees its matching image already exists in GHCR; if image publishing fails, no Git tag/release is created for that version.
- **FR-015**: The system MUST ensure version numbers are strictly increasing and unique — the same version number must never be assigned to two different commits/images.
- **FR-016**: The system MUST NOT perform any automated deployment of the published image to a runtime environment; its responsibility ends at publishing the image and creating the corresponding Git tag/release.
- **FR-017**: Re-running the pipeline for a `main` state that has already been released MUST NOT create a duplicate or conflicting version, Git tag, or release.

### Key Entities

- **Release**: A single automated outcome of the pipeline that successfully determines a new version. Associated with exactly one SemVer version number, one Git tag/release, and one published, version-tagged Docker image.
- **Commit**: A unit of change pushed to `main`. Carries a message that may or may not contain a Conventional Commits prefix; the set of commits since the last Release determines whether a new Release happens and, if so, its version bump type.
- **Docker Image**: The single build artifact published to GHCR for a given Release, containing both backend and frontend code/artifacts, carrying both the version tag and (for the latest Release) the `latest` tag.
- **Container Role**: A way of running the Docker Image — "backend" or "frontend" — distinguished only by the start command given to the container at run time, never by the image itself. The project's `docker-compose` configuration defines one service per role.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful pushes to `main` containing at least one version-qualifying commit result in exactly one published, correctly version-tagged GHCR image within the pipeline's normal run time, with no manual steps.
- **SC-002**: 0% of pipeline runs where the build/test suite fails, or where either Container Role's smoke test (FR-005a) fails, result in a published image, version tag, or release.
- **SC-003**: 0% of pushes to `main` with no version-qualifying commits result in a new version number, Git tag, or release being created.
- **SC-004**: 100% of published version-tagged images have a corresponding Git tag/release carrying the identical version number — the two are never out of sync.
- **SC-005**: A maintainer can determine the currently released version of FluxIP by looking at either GHCR's image tags or the repository's Git tags/releases and get the same answer, without needing to inspect any file in the repository that tracks a version manually.
- **SC-006**: Both the backend and the frontend can be started successfully from the identical published image using only a different start command — with no rebuild, no separate image pull, and no image variant switch required to run either role.

## Assumptions

- **Starting version**: The very first automated release (when no prior version tag exists) starts at `0.1.0` — SemVer's `1.0.0` is treated as a deliberate stability declaration a maintainer makes explicitly (e.g. via the first breaking-change commit), not something the pipeline asserts automatically on its first run. A maintainer can override this once by pushing an initial tag before the pipeline's first run if a different starting point is wanted.
- **Publish-before-tag ordering**: If the Docker image publish and the Git tag/release creation don't both succeed in the same run, the image is published first and the Git tag/release is only created once that publish is confirmed successful — so a Git tag's existence always guarantees its image already exists in GHCR. If tag/release creation then fails, the already-published image is tolerated (no automatic rollback); the missing tag/release is created on a subsequent successful run.
- **Branch scope**: Only pushes to `main` trigger the pipeline described here. Running the build/test suite against pull requests as a pre-merge safety check (without publishing anything) is a related but separate concern, not covered by this specification.
- **Image naming**: The single Docker image is published under GHCR using the repository's own name/owner (e.g. `ghcr.io/<owner>/fluxip`); no separate naming scheme is introduced.
- **Squash vs. merge commits**: Whatever commits actually land on `main` (whether that's every individual commit from a feature branch or a single squashed commit per pull request) are the commits scanned for Conventional Commits prefixes — this specification does not mandate a particular merge strategy.
- **Non-qualifying commit types**: Conventional Commit types that don't map to `fix:`/`feat:`/breaking (e.g. `chore:`, `docs:`, `refactor:`, `test:`, `ci:`) are treated the same as commits with no recognizable prefix at all for the purposes of version determination — they never trigger a release on their own.
- **How backend vs. frontend code coexist in one image**: This specification requires that one image contain both parts and that a start command select the role at run time; the specific packaging technique (e.g. multi-stage build copying both build outputs into one final image) is a planning-phase decision, not fixed here.
- **Tooling choice**: Which specific tool or GitHub Action implements Conventional-Commits-based version determination is a planning-phase decision, not fixed by this specification.
