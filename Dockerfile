FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
# Works around a QEMU user-mode emulation bug where esbuild's Go binary
# crashes with "runtime: lfstack.push invalid packing" / "fatal error:
# lfstack.push" when cross-building under emulation (either direction: arm64
# build on an amd64 CI runner, or amd64 build on an arm64 CI runner).
# GODEBUG=asyncpreemptoff=1 covers signal-preemption-triggered crashes;
# setarch -R (disable ASLR) below covers the mmap-high-address variant seen
# on arm64 hosts with 5-level paging (52-bit VA), where QEMU hands Go
# addresses above the 48-bit boundary its lock-free stack assumes fit.
ENV GODEBUG=asyncpreemptoff=1
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN setarch "$(uname -m)" -R pnpm install --frozen-lockfile
COPY backend ./backend
COPY frontend ./frontend
RUN setarch "$(uname -m)" -R pnpm -r build

FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --prod --frozen-lockfile

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# frontend/node_modules/.bin so the frontend role's `serve` start command
# resolves directly (the repo-root docker-entrypoint.sh below just
# `exec "$@"`s the given command verbatim, unlike the base image's own
# docker-entrypoint.sh which it replaces).
ENV PATH="/app/frontend/node_modules/.bin:/app/node_modules/.bin:${PATH}"
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=prod-deps /app/frontend/node_modules ./frontend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
# The Node helper docker-entrypoint.sh below invokes to (re)generate
# frontend/dist/config.js at container start (specs/006-frontend-runtime-config)
# — not part of frontend/dist, so it needs its own COPY.
COPY --from=build /app/frontend/scripts ./frontend/scripts
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
EXPOSE 8080 3000
