# RepoWrangler — Node server host (zero Cloudflare).
#
# Builds the SPA and runs the same API + scheduler as the Worker on SQLite.
# Build context is the repository root:  docker build -f apps/server/Dockerfile .
#
# Node 22 is required for the built-in node:sqlite module (behind
# --experimental-sqlite). Pinned deliberately — see apps/server/README.md.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Enable the repo's pinned pnpm via corepack (packageManager in package.json).
RUN corepack enable

# Copy the whole workspace and install (dev deps included — vite builds the SPA,
# tsx runs the server). .dockerignore keeps node_modules/.git/dist out.
COPY . .
RUN pnpm install --frozen-lockfile

# Build the SPA into apps/web/dist (served by the host for non-API routes).
RUN pnpm --filter @repo-wrangler/web build

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG APP_VERSION
ENV NODE_ENV=production \
    PORT=8080 \
    SQLITE_PATH=/app/data/repo-wrangler.db \
    APP_VERSION=${APP_VERSION}

RUN corepack enable

# Bring over the fully-installed workspace and the built SPA.
COPY --from=build /app /app

# Run as the non-root `node` user (uid 1000) the base image ships — matches
# the runAsUser: 1000 the Kubernetes manifests enforce. The named volume at
# /app/data inherits this image-layer ownership, so it stays writable.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

# Persist the SQLite database outside the image layer.
VOLUME ["/app/data"]
EXPOSE 8080

# node:sqlite needs the experimental flag on Node 22; tsx runs the TS sources.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-sqlite", "--import", "tsx", "apps/server/src/index.ts"]
