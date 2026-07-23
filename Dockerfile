FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile
COPY backend ./backend
COPY frontend ./frontend
RUN pnpm -r build

FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --prod --frozen-lockfile

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# frontend/node_modules/.bin so the frontend role's `serve` start command
# resolves directly (docker-entrypoint.sh only execs bare commands found on
# PATH; anything else it wraps as `node <arg>`, which would misinterpret
# `serve` as a script path).
ENV PATH="/app/frontend/node_modules/.bin:/app/node_modules/.bin:${PATH}"
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=prod-deps /app/frontend/node_modules ./frontend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/frontend/dist ./frontend/dist
EXPOSE 8080 3000
