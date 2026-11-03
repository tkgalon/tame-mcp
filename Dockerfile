# syntax=docker/dockerfile:1

FROM node:22.15.0-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

# Manifests first so the dependency layer is reused when only source changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/extraction/package.json packages/extraction/
RUN pnpm install --frozen-lockfile

COPY . .
# Settings are read at runtime, these values only let the build load its config
RUN NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_build_only \
    TAME_SITE_URL=http://localhost:3000 \
    pnpm build

FROM node:22.15.0-bookworm-slim
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
