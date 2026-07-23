# Quickstart: Validating the Automated Docker Release Pipeline

This is a validation/run guide, not an implementation guide — it proves the feature end-to-end against `contracts/release-workflow.md` and the acceptance scenarios in `spec.md`. Full workflow YAML, Dockerfile, and script code live in the implementation (tasks.md), not here.

## Prerequisites

- A GitHub repository with Actions enabled and GHCR available under the repository owner's namespace (`GITHUB_TOKEN` with `contents: write`/`packages: write` is sufficient, no extra secrets).
- **One-time setup before the pipeline's first real run**: seed a baseline tag so version computation has something to bump from (research.md §4):
  ```bash
  git tag v0.1.0
  git push origin v0.1.0
  ```

## Scenario 1 — Automatic versioned release, one image (validates User Story 1)

1. With the `v0.1.0` baseline tag in place, push a commit to `main` whose message starts with `fix: `.
2. **Expected**: the workflow run succeeds; exactly one new image tagged `0.1.1` (bare, no `v`) appears at `ghcr.io/<owner>/fluxip`, also updated at `:latest`; a Git tag `v0.1.1` and matching GitHub Release exist.
3. Repeat with a `feat: ` commit → expect `0.2.0`. Repeat with a `feat!: ` commit (or `BREAKING CHANGE:` footer) → expect `1.0.0`.

## Scenario 2 — One image, two runtime roles (validates User Story 2)

1. Pull the published version-tagged image: `docker pull ghcr.io/<owner>/fluxip:<version>`.
2. Start it as the backend: `docker run --rm -p 8080:8080 --env-file .env ghcr.io/<owner>/fluxip:<version> node backend/dist/main.js`.
3. **Expected**: the backend responds on its port (e.g. `curl localhost:8080/metrics` returns `200`).
4. Without pulling anything new, start the same image as the frontend instead: `docker run --rm -p 3000:3000 ghcr.io/<owner>/fluxip:<version> serve -s frontend/dist -l 3000`.
5. **Expected**: the frontend responds (`curl localhost:3000/` returns `200`, serving `index.html`).
6. Run `docker compose up` against the project's `docker-compose.yml` and confirm both `app` and `frontend` services start successfully, both built from the same image, differing only in their configured `command:`.

## Scenario 3 — Broken code (including a broken start command) never publishes (validates User Story 3)

1. Push a commit to `main` that breaks `pnpm --filter fluxip-backend test` or `pnpm -r build`.
2. **Expected**: the workflow fails at that step; no image, tag, or Release is created.
3. Separately, push a commit that leaves the build/tests passing but breaks one start command specifically (e.g. an invalid path in the frontend's `serve` command, or a syntax error only hit at backend runtime, not compile time).
4. **Expected**: the image builds, but the corresponding smoke test (`contracts/release-workflow.md`) fails; the workflow fails before the push step; no image, tag, or Release is created — even though the *other* role's start command would have worked fine.

## Scenario 4 — Non-qualifying commits stay silent (validates User Story 4)

1. Push a commit to `main` with a message that doesn't map to a version bump (e.g. `chore: tidy up`, or a message with no Conventional Commits prefix at all), with no other qualifying commit since the last release.
2. **Expected**: `determine-version` reports `should-release: "false"`; the push/tag steps are skipped; the workflow still succeeds overall (build, test, and both smoke tests still ran and passed — FR-001 is unconditional); no new image, Git tag, or Release is created.

## Scenario 5 — Publish-order guarantee under partial failure (validates the confirmed FR-014 ordering)

1. Simulate an image-push failure after version determination and both smoke tests succeed (e.g. temporarily invalidate registry credentials in a disposable test workflow copy — this is a fault-injection scenario, exact mechanics depend on what's safe to break without affecting real `main`).
2. **Expected**: because the Git-tag-creation step never runs until *after* the image push reports success, no Git tag or Release exists for the version that failed to publish. Fixing the issue and re-running (or pushing a trivial follow-up qualifying commit) completes the release normally.

## Cleanup

Delete any test tags/releases created during validation (e.g. `git push origin :refs/tags/v0.1.1`) and remove corresponding test images from GHCR if this was run against a real repository rather than a disposable fork/test repo.
