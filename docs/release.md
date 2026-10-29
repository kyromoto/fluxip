# Release process

Every push to `main` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds and tests the project, builds **one** Docker image containing both the backend and frontend, smoke-tests both runtime roles from that image, and — if a commit since the last release qualifies — publishes the image and cuts a version automatically. There are no manual version bumps and no manual `docker build`/`push`.

**Versioning**: the next version is computed from [Conventional Commits](https://www.conventionalcommits.org/) prefixes on commits since the last release tag, via `semantic-release`'s commit analyzer (config: [`.releaserc.json`](../.releaserc.json)):

| Commit prefix | Bump |
|---|---|
| `fix:` | patch (`0.1.0` → `0.1.1`) |
| `feat:` | minor (`0.1.0` → `0.2.0`) |
| `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer | major (`0.1.0` → `1.0.0`) |
| `perf:` / `revert:` | patch |
| anything else (`chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, no prefix, ...) | no release |

**Multiple commits per push**: a push produces at most **one** release. All commits since the last release tag are analysed together and the highest bump wins (e.g. three `fix:` and one `feat:` → one minor bump, not four bumps). Commits with the scope `agent` (e.g. `fix(agent): ...`) never trigger a release on their own; the agent is released separately via [`agent-release.yml`](../.github/workflows/agent-release.yml).

**One image, two runtime roles**: the published image (`ghcr.io/<owner>/fluxip`) contains both the backend and the frontend's static build. Which one runs is chosen entirely by the container's start command, not by a different image or tag — see `docker-compose.yml`'s `app` (`command: ["node", "backend/dist/main.js"]`) and `frontend` (`command: ["serve", "--single", "frontend/dist", "-l", "3000"]`) services. The same pattern works against the published image directly:

```bash
# once per version, before the backend starts (the backend no longer migrates on startup)
docker run --rm --env-file .env ghcr.io/<owner>/fluxip:<version> node backend/dist/cli.js migrate
docker run --env-file .env -p 8080:8080 ghcr.io/<owner>/fluxip:<version> node backend/dist/main.js
docker run -p 3000:3000 ghcr.io/<owner>/fluxip:<version> serve --single frontend/dist -l 3000
```

Without the `migrate` step the backend stops on start with a message naming it. In Docker Compose, the `migrate` service does it before `app` starts.

A repo-root `docker-entrypoint.sh` runs before either start command and regenerates the frontend's runtime `config.js` from the `FRONTEND_*` env vars on every container start — see `specs/006-frontend-runtime-config/`.

**Changelog**: `determine-version.mjs` also renders the release notes (grouped by commit type, via `@semantic-release/release-notes-generator`). They become the body of the GitHub Release, and are prepended to [`CHANGELOG.md`](../CHANGELOG.md), which the last workflow step commits to `main` as `chore(release): vX.Y.Z [skip ci]`. If `main` is branch-protected, that push needs a bypass for `github-actions[bot]`.

**Running version**: the release workflow passes the computed version into the image as `FLUXIP_VERSION`; the backend reports it at `GET /api/version` and the GUI shows it under the logo (`dev` outside a release build, e.g. local development).

**Where to find things**: published image tags and `:latest` are under `ghcr.io/<owner>/fluxip` (GitHub Container Registry, repository Packages tab); each release also gets a matching Git tag (`vX.Y.Z`) and GitHub Release. A version's Git tag is only ever created after that version's image has already published successfully — never before, never independently.

**Safety**: a push that fails the build, the tests, the Docker build, or either role's smoke test never publishes anything — the job simply fails at that step. A push with no qualifying commit still runs the full build/test/smoke-test pipeline (so regressions are still caught) but publishes nothing.
