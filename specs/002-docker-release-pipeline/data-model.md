# Phase 1 Data Model: Automated Docker Release Pipeline

This feature has no application database — its "data model" is the set of entities the pipeline reasons about, represented by existing Git/GHCR/Docker primitives. This document defines those entities per spec.md's Key Entities, their fields, relationships, and the pipeline's own run-state transitions.

## Entity: Release

The outcome of one successful, version-determining pipeline run.

| Field | Type | Notes |
|---|---|---|
| `version` | string, SemVer (`MAJOR.MINOR.PATCH`) | Strictly increasing (FR-015); computed, never manually set (FR-007) |
| `gitTag` | string, `v${version}` | Created only after the image publishes successfully (FR-014, research.md §2) |
| `commitSha` | string | The `main` commit the release was cut from |
| `bumpType` | `major` \| `minor` \| `patch` | Determined by the highest-precedence qualifying commit since the last Release (FR-009/FR-010) |
| `image` | `DockerImage` (exactly 1) | Carries `version` and, since this is the latest Release, `latest` (FR-012/FR-013) |

**Identity/uniqueness**: A Release is identified by its `version`; FR-015 requires no two Releases ever share one. A failed or no-op run produces no Release (FR-006/FR-011).

**Relationship**: `Release (1) ──> (1) DockerImage` (changed from the two-image version of this plan — see research.md §5). `Release (1) ──> (many) Commit` (the commits since the previous Release whose bump-worthy prefixes were scanned, per FR-010).

## Entity: Commit

A unit of change on `main`, evaluated only for its Conventional Commits classification.

| Field | Type | Notes |
|---|---|---|
| `sha` | string | |
| `message` | string | Subject + optional body/footer |
| `conventionalType` | string \| null | e.g. `feat`, `fix`, `chore`, or `null` if unparseable |
| `breaking` | boolean | `true` if `!` follows the type/scope or a `BREAKING CHANGE:` footer is present (FR-009, research.md §3) |
| `bumpContribution` | `major` \| `minor` \| `patch` \| `none` | Derived: `breaking` → `major`; `feat` → `minor`; `fix` → `patch`; anything else → `none` |

**Validation rule**: A Commit with `bumpContribution == "none"` never triggers a Release on its own (FR-011) and doesn't block or alter a Release triggered by other qualifying commits in the same push.

## Entity: Docker Image

The single published GHCR artifact for one Release.

| Field | Type | Notes |
|---|---|---|
| `repository` | `fluxip` | One repository now, not two (research.md §11) |
| `versionTag` | string, bare SemVer (no `v` prefix) | e.g. `1.2.4` |
| `latestTag` | boolean | `true` for the most recently published Release's image |
| `containsBackend` | boolean | Always `true` — both parts are always present (FR-002) |
| `containsFrontend` | boolean | Always `true` |

**Validation rule**: A `versionTag` image is never published unless the build/test suite and both Container Roles' smoke tests passed (FR-005/FR-005a/FR-006).

## Entity: Container Role

A way of running the Docker Image — distinguished only by the start command given to the container, never by the image itself (FR-003).

| Field | Type | Notes |
|---|---|---|
| `name` | `backend` \| `frontend` | Exactly two roles (FR-004) |
| `startCommand` | string | `node backend/dist/main.js` for `backend`; `serve -s frontend/dist -l <port>` for `frontend` (research.md §6) |
| `composeService` | `app` \| `frontend` | The `docker-compose.yml` service name that runs this role (research.md §10) |
| `smokeTestCheck` | string (HTTP path) | `/metrics` for `backend`, `/` for `frontend` (research.md §8) |

**Invariant**: Both roles are always built into the same image (`Docker Image.containsBackend/containsFrontend` are both always `true`) — a Container Role is a *runtime* distinction, never a *build-time*/image-variant one.

## Pipeline Run (state transitions)

Not a persisted entity, but the state machine every push to `main` drives through — a single job, per research.md §9:

```text
push to main
     │
     ▼
[Build & Test] ──fail──► STOP (no image built beyond this point, nothing published) [FR-005, FR-006]
     │ pass
     ▼
[Docker Build] (local, tagged, not yet pushed) ──fail──► STOP [FR-006]
     │ success — exactly one image now exists locally, containing both roles
     ▼
[Smoke Test: backend role] ──fail──► STOP (nothing published) [FR-005a, FR-006]
     │ pass
     ▼
[Smoke Test: frontend role] ──fail──► STOP (nothing published) [FR-005a, FR-006]
     │ pass
     ▼
[Determine Version] ──no qualifying commit──► STOP (no version, no tag, no push) [FR-011]
     │ version vX.Y.Z determined
     ▼
[Push image to GHCR: vX.Y.Z + latest] ──fail──► STOP (no tag created) [FR-014]
     │ success
     ▼
[Create Git tag vX.Y.Z + GitHub Release] ──► Release vX.Y.Z exists; Git tag and the image's
                                              version tag are now guaranteed in sync [FR-014, SC-004]
```

**Idempotency / re-run** (FR-017): If re-entered for a `main` state that already has a matching Git tag, version determination recognizes the existing tag and the run becomes a no-op from "Determine Version" onward — semantic-release's own tag-scanning provides this for free (research.md §1).
