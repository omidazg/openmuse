# OpenMuse API + task worker + static Expo web app in one image.
#
#   docker build -t openmuse .
#   docker build -t openmuse \
#     --build-arg REGISTRY_MIRROR=docker.arvancloud.ir/ \
#     --build-arg NPM_REGISTRY=https://<your-npm-mirror>/ \
#     --build-arg EXPO_PUBLIC_API_URL=https://muse.example.ir .
#
# REGISTRY_MIRROR must end with "/" (it is prepended to the image name).
# EXPO_PUBLIC_API_URL is baked into the web bundle at build time; set it to the
# public origin that serves this image (e.g. https://$DOMAIN).

ARG REGISTRY_MIRROR=
ARG NODE_IMAGE=library/node:24-bookworm-slim

FROM ${REGISTRY_MIRROR}${NODE_IMAGE} AS base
ARG NPM_REGISTRY=
ARG PNPM_VERSION=11.19.0
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    DO_NOT_TRACK=1 \
    EXPO_NO_TELEMETRY=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && npm install -g "pnpm@${PNPM_VERSION}" \
    && if [ -n "$NPM_REGISTRY" ]; then pnpm config set registry "$NPM_REGISTRY"; fi
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/worker/package.json apps/worker/package.json

# Full workspace install (server build tooling + Expo web toolchain).
FROM base AS deps
RUN pnpm install --frozen-lockfile

# Production dependencies of the root package only (the API/worker runtime).
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter openmuse

FROM deps AS build
ARG EXPO_PUBLIC_API_URL=
COPY . .
RUN pnpm build:server
RUN if [ -z "$EXPO_PUBLIC_API_URL" ]; then \
      echo "WARNING: EXPO_PUBLIC_API_URL is empty; the web app will call http://localhost:8787" >&2; \
    fi \
    && EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" pnpm build:web

FROM ${REGISTRY_MIRROR}${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    WEB_DIST=/app/web \
    DO_NOT_TRACK=1 \
    COPILOTKIT_TELEMETRY_DISABLED=true
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/mobile/dist/web ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Task worker: override the command with  node dist/apps/server/src/worker-entry.js
CMD ["node", "dist/apps/server/src/index.js"]
