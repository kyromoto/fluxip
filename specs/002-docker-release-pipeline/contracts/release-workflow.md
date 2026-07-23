# Contract: Release Workflow

This is the interface FluxIP's release automation exposes — to GitHub itself (trigger/permissions), to a deployer (the image's runtime-role contract), and internally between the workflow's own steps (the version-determination script's output contract).

## Trigger

| Event | Condition | Effect |
|---|---|---|
| `push` | `branches: [main]` | Runs the full pipeline described below (FR-001) |
| Anything else (PRs, other branches, tags, manual dispatch) | — | Out of scope for this workflow (confirmed via `/speckit-clarify` on the prior version of this spec) — not handled |

## Required permissions

```yaml
permissions:
  contents: write   # create Git tags + GitHub Releases (FR-014)
  packages: write   # push the image to GHCR (FR-012)
```

## Runtime contract: the published image

This is the contract a *deployer* relies on, not just CI — it's what `docker-compose.yml` and any future deployment target both depend on.

| Aspect | Contract |
|---|---|
| Image reference | `ghcr.io/<owner>/fluxip:<version>` and `ghcr.io/<owner>/fluxip:latest` — one repository, both tags always point at the same image for a given Release (FR-002, FR-012, FR-013) |
| Backend role | `docker run ... ghcr.io/<owner>/fluxip:<version> node backend/dist/main.js` — requires the same environment variables `backend/src/config/env.ts` already requires (`DATABASE_URL`, `REDIS_URL`, `CLOUDEVENTS_SOURCE`, etc.); unchanged by this feature |
| Frontend role | `docker run ... ghcr.io/<owner>/fluxip:<version> serve -s frontend/dist -l <port>` — serves the static SPA build, no environment variables required |
| Role selection | Exclusively via the container's start command (`CMD`/`command:` override) — never via a different image, tag, or environment variable (FR-003) |

## Step contract: `determine-version` script

**Inputs** (environment): `GITHUB_TOKEN` (read tag/commit history); full Git history + tags (`actions/checkout` with `fetch-depth: 0` — a shallow clone cannot see prior release tags).

**Outputs** (written to `$GITHUB_OUTPUT`):

| Name | Type | Meaning |
|---|---|---|
| `should-release` | `"true"` \| `"false"` | `"false"` when no commit since the last release tag carries a qualifying prefix (FR-011) — push/tag steps are skipped |
| `version` | string (bare SemVer) | Only meaningful when `should-release == "true"` |
| `git-tag` | string (`v` + version) | Only meaningful when `should-release == "true"` |

**Guarantee**: This step never publishes anything and never creates a Git tag itself (research.md §2) — it only computes and reports, and always exits `0` (a "no release needed" result is not a failure).

## Step contract: Docker build + smoke test

| Step | Behavior |
|---|---|
| `docker build` | Builds the single image from the root `Dockerfile`, tagged locally, **not pushed**. Runs on every push regardless of `should-release` (FR-001 is unconditional). |
| Backend smoke test | `docker run --network host -e DATABASE_URL=... -e REDIS_URL=... -e CLOUDEVENTS_SOURCE=... -e CLOUDEVENTS_TYPE_PREFIX=... -e LOGTO_ENDPOINT=... -e CREDENTIAL_ENCRYPTION_KEY=... <local-tag> node backend/dist/main.js`, poll `GET http://localhost:8080/metrics` for `200` within 15s, then stop the container. Env vars are required — `backend/src/config/env.ts`'s `loadConfig()` throws before the port ever opens if any are missing. `DATABASE_URL`/`REDIS_URL` point at the job's real Postgres/Redis services; the rest are well-formed dummies (never contacted at startup). Failure stops the job (FR-005a/FR-006). |
| Frontend smoke test | `docker run --network host ... <local-tag> serve -s frontend/dist -l <port>`, poll `GET http://localhost:<port>/` for `200` within 15s, then stop the container. No environment variables required — the static build has no runtime config. Failure stops the job (FR-005a/FR-006). |

**Guarantee**: Both smoke tests run on every push (not conditioned on `should-release`), so a broken start command is caught even on pushes that wouldn't otherwise produce a Release.

## Step contract: publish + tag

| Step | Condition to run | On failure |
|---|---|---|
| Push `ghcr.io/<owner>/fluxip:{version}` + `:latest` | `should-release == 'true'` and both smoke tests passed | Workflow fails; no Git tag step runs (FR-014) |
| Create Git tag `{git-tag}` + GitHub Release | Image push succeeded | — |

**Guarantee** (FR-014, SC-004): a Git tag for a version is created if and only if that version's image is already live in GHCR — never before, never independently.

## Idempotency contract (FR-017)

Re-running this workflow for a `main` commit that already has a matching Git tag MUST NOT produce a duplicate tag/release or attempt to re-push an already-existing version tag. This holds automatically: semantic-release computes the next version from the latest existing tag it finds, so a re-run with no new qualifying commits since that tag reports `should-release: "false"`.
