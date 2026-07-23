# Phase 0 Research: Automated Docker Release Pipeline

All Technical Context fields were resolvable without leaving `NEEDS CLARIFICATION` markers. This document records the *why* behind each non-obvious choice.

## 1. Version-determination tool

- **Decision**: `semantic-release`, but used *only* for its `@semantic-release/commit-analyzer` plugin, invoked in dry-run mode to compute the next version number — not for its own publish/tag orchestration.
- **Rationale**: `commit-analyzer` is the de facto standard, battle-tested implementation of "scan commits since the last release tag, find the highest-precedence Conventional Commits bump type" (FR-009/FR-010). Reimplementing that parsing by hand would reinvent well-tested logic for no benefit.
- **Alternatives considered**: `googleapis/release-please` — rejected because its default model opens a "release PR" a human/bot must merge before a release cuts, a fundamentally different two-step flow than this spec's "push triggers release immediately." Hand-rolled `git log` regex parsing — rejected as reinventing well-tested logic.

## 2. Why semantic-release does NOT run its own publish/tag steps

- **Decision**: The actual Docker build/push and Git tag/GitHub Release creation are explicit, ordered steps in the workflow itself, not semantic-release plugins.
- **Rationale**: semantic-release's core creates the Git tag automatically *before* any `publish`-step plugins run, and does not roll it back if a later publish plugin fails (confirmed against the maintainers' own guidance in semantic-release/semantic-release#4103). That is the opposite of FR-014's confirmed ordering (image must publish successfully before the Git tag is created). The maintainers' own recommended workaround for exactly this situation is: *"compute the version first, run your publishes, then tag and create the GH release last"* — exactly the split this plan uses.
- **Alternatives considered**: `@semantic-release/exec` + `@semantic-release/git`/`@semantic-release/github` as publish-step plugins — rejected once the tag-before-publish ordering was confirmed, since it would create an unpublished-image tag on any Docker push failure.

## 3. Conventional Commits preset (breaking-change syntax)

- **Decision**: Configure `commit-analyzer` with `preset: "conventionalcommits"` (via `conventional-changelog-conventionalcommits`), not the plugin's default `angular` preset.
- **Rationale**: The default `angular` preset only recognizes a `BREAKING CHANGE:` footer — not the `feat!:`/`fix!:` exclamation-mark shorthand FR-009 explicitly requires supporting. `conventionalcommits` supports both.
- **Alternatives considered**: Default `angular` preset — rejected, would silently fail to trigger a MAJOR bump on `feat!:`-style commits.

## 4. Initial version bootstrap (`0.1.0` baseline)

- **Decision**: Seed the repository with a one-time, manually-created `v0.1.0` Git tag (no associated image) before the pipeline's first real run.
- **Rationale**: semantic-release hardcodes its own "no prior release" case to `1.0.0` and doesn't support a configurable different from-scratch starting version. Seeding an initial tag is the documented, community-standard way to get semantic-release-family tooling to start anywhere other than `1.0.0`, matching this spec's confirmed `0.1.0` baseline (FR-008).
- **Alternatives considered**: Patching commit-analyzer's version-bump math to special-case the from-scratch scenario — rejected as unnecessary complexity for a one-time, one-line `git tag` setup step (documented in quickstart.md).

## 5. Combining backend and frontend into one image

- **Decision**: A single new root-level `Dockerfile` (multi-stage), replacing the two existing per-workspace Dockerfiles. Build context is the repo root so the same build can see both `backend/` and `frontend/`. The final runtime stage contains `backend/dist` (compiled Node output) and `frontend/dist` (static build output) side by side, plus each workspace's production `node_modules`. No default `CMD` bakes in a role — the caller (docker-compose's `command:`, or a deployer's own container-start override) always supplies which start command to run, per FR-003.
- **Rationale**: FR-002 requires exactly one image containing both parts; a single combined build context is the only way to copy artifacts from both workspaces into one final stage. Not baking in a default role keeps the image genuinely role-agnostic rather than "backend by default, frontend as a special case," matching FR-003's "determined entirely by the start command" requirement.
- **Alternatives considered**: Keep two Dockerfiles and merge their outputs via a third "assembly" image referencing both as build stages — rejected, unnecessarily indirect compared to one Dockerfile with two `COPY --from=` sources within the same build.

## 6. Frontend static-file serving: `serve` instead of nginx

- **Decision**: Replace the frontend's current nginx-based runtime with the `serve` npm package (added as a `frontend/package.json` runtime dependency), started via `serve -s frontend/dist -l <port>`.
- **Rationale**: The whole point of one shared image is that both roles run from the same runtime. Keeping nginx would mean bundling two different process managers (nginx *and* Node) into one image just so the frontend role can pick one of them — more moving parts for no benefit, since Node is already present for the backend role. `serve`'s `-s`/`--single` flag provides the SPA fallback (serve `index.html` for unmatched routes) that the existing nginx setup implicitly needed for `@solidjs/router`'s client-side routing.
- **Alternatives considered**: Installing nginx *into* the same image alongside Node, with the start command choosing which process manager to invoke — rejected as strictly more complex (two runtimes in one image) for no functional benefit over a Node-based static server. Other Node static-server packages (`http-server`, `sirv-cli`) — `serve` was chosen only as a well-known, actively maintained default; any of these would satisfy the requirement equally, this is a low-stakes choice.

## 7. Dependency installation strategy for the combined image

- **Decision**: Plain `pnpm install` (all workspaces) at the repo root, both for the build stage (full deps, to run `pnpm -r build`) and a second `--prod`-only pass for the runtime stage — copying the resulting root + per-workspace `node_modules` trees wholesale into the final image, the same pattern the existing (now-superseded) `backend/Dockerfile` already used for a single workspace.
- **Rationale**: pnpm's own `pnpm deploy` command (designed for producing a pruned, self-contained directory for *one* workspace package) exists specifically for the "many packages, ship only one lean artifact" case — but this feature's entire premise is the opposite: ship *all* of both workspaces' production output together in one image. There's nothing to prune toward. Plain workspace install is simpler and needs no extra `pnpm-workspace.yaml` configuration (`pnpm deploy` requires `inject-workspace-packages: true` or a `--legacy` flag).
- **Alternatives considered**: `pnpm deploy --filter <pkg> --prod` per workspace, copying each pruned deployment directory into the final stage separately — rejected as solving a problem (per-package isolation/pruning) this feature doesn't have, adding workspace-config changes for no benefit.

## 8. Smoke-test design and networking (FR-005a)

- **Decision**: After the image is built locally (loaded into the runner's Docker daemon, not yet pushed), two short-lived containers are started from it in the same job — one with the backend's start command, one with the frontend's — each using `--network host` so the backend container can reach the job's real Postgres/Redis service containers (already provisioned for `pnpm --filter fluxip-backend test`) at `localhost:5432`/`localhost:6379`, exactly as they're already exposed to the runner. The backend container also needs the rest of `backend/src/config/env.ts`'s required variables (`CLOUDEVENTS_SOURCE`, `CLOUDEVENTS_TYPE_PREFIX`, `LOGTO_ENDPOINT`, `CREDENTIAL_ENCRYPTION_KEY`) passed as well-formed dummy values — `loadConfig()` validates their presence/format at startup, before migrations even run, regardless of network reachability. The backend smoke test polls its `/metrics` endpoint (already unauthenticated, no new endpoint needed) for a `200`; the frontend smoke test polls `/` for a `200`. Both containers are stopped afterward regardless of outcome.
- **Rationale**: The backend's startup sequence runs Postgres migrations before it starts listening (`backend/src/main.ts`), so a smoke test with no reachable database wouldn't actually reach "server up" — it would just prove config validation works, missing exactly the "start command is fundamentally broken" failure mode the smoke test exists to catch (per `/speckit-clarify`). Reusing the same job's existing service containers (rather than provisioning new ones) avoids duplicating infrastructure. `/metrics` was chosen as the backend smoke-test target because it already exists, requires no auth, and only responds once the HTTP server is actually listening.
- **Alternatives considered**: A dedicated `/health` endpoint — rejected as unnecessary new application code when `/metrics` already serves the same "is it up" purpose. Running the smoke test in a separate job with its own fresh Postgres/Redis service containers — rejected as duplicated setup for no isolation benefit, and would require passing the built image between jobs (`docker save`/`load` or a registry round-trip) instead of reusing the daemon already holding it.

## 9. Single job vs. multiple jobs

- **Decision**: One job (not split into `test`/`release` jobs as an earlier version of this plan considered), with ordered steps: checkout → install → `pnpm -r build` → `pnpm --filter fluxip-backend test` (with Postgres/Redis services) → `docker build` (local, tagged, not pushed) → backend smoke test → frontend smoke test → determine version → (if a version is warranted) push to GHCR (version + `latest`) → (if push succeeded) create Git tag/GitHub Release.
- **Rationale**: The image only needs to be built once. Splitting into a `test` job and a `release` job (as this plan's earlier two-image draft did) would mean either rebuilding the image in the second job (wasted work, and a second build could theoretically diverge from what was smoke-tested) or passing the built image between jobs via `docker save`/`load`, adding real complexity for a project this size. A single job's default step-failure-stops-the-job behavior already gives FR-006's gating for free — build/test/smoke-test failures never reach the push/tag steps.
- **Alternatives considered**: Two jobs with image passed via `actions/upload-artifact`/`docker save` — rejected as solving a problem (this project has none) at real complexity cost; two jobs rebuilding the image twice — rejected as wasteful and risks the pushed image not being byte-identical to what was smoke-tested.

## 10. `docker-compose.yml`: one image, two services

- **Decision**: Both the `app` and `frontend` services in `docker-compose.yml` build from the same `context: .` / `dockerfile: Dockerfile`, and are distinguished only by a `command:` override (`node backend/dist/main.js` for `app`; `serve -s frontend/dist -l <port>` for `frontend`).
- **Rationale**: Directly satisfies FR-004 with no new services and minimal diff to the existing compose file's shape (both service names, `depends_on`, `ports`, and env wiring stay conceptually the same as today — only `build`/`command` change). Deployers using the *published* GHCR image instead of building locally can swap `build:` for `image: ghcr.io/<owner>/fluxip:<version>` with the same `command:` pattern.
- **Alternatives considered**: A single service with a `ROLE` environment variable an entrypoint script branches on — rejected as extra indirection (a shell script making the role decision) when Docker Compose's own `command:` override already expresses "which start command" directly and simply, matching FR-003's own wording.

## 11. GHCR image naming

- **Decision**: `ghcr.io/<owner>/fluxip`, tagged with the bare SemVer version (e.g. `1.2.4`) and `latest`.
- **Rationale**: One image now needs only one repository name — simpler than the two-image version of this plan's `fluxip-backend`/`fluxip-frontend` split.
- **Alternatives considered**: N/A — this follows directly from FR-002's single-image requirement.

## 12. GHCR authentication

- **Decision**: `docker/login-action` against `ghcr.io` using the workflow's own `GITHUB_TOKEN`, with `permissions: packages: write, contents: write`.
- **Rationale**: Scoped automatically to the triggering repository, no extra secret provisioning.
- **Alternatives considered**: A dedicated PAT — rejected as unnecessary extra credential-management surface for a same-repository publish target.
