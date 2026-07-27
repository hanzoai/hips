# hips.hanzo.ai — a Next.js static export served by hanzoai/static, the house
# static server (a Go binary on scratch). No nginx, no GitHub Pages, no CF Pages:
# the site is an image the operator runs behind hanzoai/ingress like every other
# Hanzo surface.

FROM node:22-alpine AS build
RUN corepack enable
# The site renders the specs from ../HIPs: source.config.ts, lib/source.ts and
# scripts/generate-search-index.mjs each resolve that from the build's working
# directory. So the build runs in /src/docs with HIPs/ as its sibling — copying
# docs/ alone leaves generate-search-index.mjs to readdirSync a path that is not
# in the image, and its ENOENT is unguarded, so prebuild dies.
WORKDIR /src/docs
COPY docs/package.json docs/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY HIPs/ /src/HIPs/
COPY docs/ ./
RUN pnpm build

# hanzoai/static listens on :3000 and serves /public.
FROM ghcr.io/hanzoai/static:v0.5.1
COPY --from=build /src/docs/out /public
