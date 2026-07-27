# hips.hanzo.ai — a Next.js static export served by hanzoai/static, the house
# static server (a Go binary on scratch). No nginx, no GitHub Pages, no CF Pages:
# the site is an image the operator runs behind hanzoai/ingress like every other
# Hanzo surface.

FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY docs/package.json docs/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY docs/ ./
RUN pnpm build

# hanzoai/static listens on :3000 and serves /public.
FROM ghcr.io/hanzoai/static:v0.5.1
COPY --from=build /src/out /public
