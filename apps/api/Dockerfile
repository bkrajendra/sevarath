# Build context is the repo root (pnpm workspace) - see k8s/README.md / CI for the
# `docker build -f apps/api/Dockerfile .` invocation.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- deps: full install (incl. devDependencies), needed to run `nest build` ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile --filter @sevarath/api...

# ---- build: compile TypeScript -> dist ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api apps/api
RUN pnpm --filter @sevarath/api build

# ---- prod-deps: production-only install, kept separate to avoid shipping devDependencies ----
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN pnpm install --frozen-lockfile --prod --filter @sevarath/api...

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/src/db/migrations ./apps/api/src/db/migrations

EXPOSE 3000
CMD ["node", "--enable-source-maps", "apps/api/dist/src/main.js"]
