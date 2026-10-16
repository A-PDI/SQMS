# syntax=docker/dockerfile:1.7
# Multi-target image build for the SQMS monorepo. Build from the repository root, e.g.
#   docker build --target api -t sqms-api .
# Targets: api, worker, web, migrate (migrations + reference seed; also runs the opt-in demo seed).
# Without --target, the SQMS_SERVICE build arg selects the image (used by render.yaml; see the end of this file).
#
# Networks with TLS inspection can supply their root CA as a build secret (never stored in an image layer):
#   docker build --secret id=build_ca,src=/path/to/corporate-ca.pem ...

# Runtime images use the slim variant; the build stage uses the full image, which also provides the OpenSSL
# libraries required by the Prisma schema engine (migrations).
ARG NODE_IMAGE=node:22.23.3-bookworm-slim
ARG NODE_BUILD_IMAGE=node:22.23.3-bookworm
ARG PNPM_VERSION=10.28.0
ARG SQMS_SERVICE=api

# ---------------------------------------------------------------------------------------------- pnpm bases
FROM ${NODE_BUILD_IMAGE} AS build-base
ARG PNPM_VERSION
ARG NODE_USE_ENV_PROXY=0
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/corepack \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /repo

FROM ${NODE_IMAGE} AS slim-base
ARG PNPM_VERSION
ARG NODE_USE_ENV_PROXY=0
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/corepack \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /repo

# ---------------------------------------------------------------------------------------------- build
FROM build-base AS build
# Manifests first so dependency installation is cached independently of source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/server-core/package.json packages/server-core/
COPY packages/legacy-domain/package.json packages/legacy-domain/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# prisma generate fetches the Prisma schema engine for this platform (also used later by `migrate deploy`).
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    pnpm build:packages \
 && pnpm --filter @sqms/api --filter @sqms/worker run build \
 && pnpm --filter @sqms/web run build

# ---------------------------------------------------------------------------------------------- production dependencies
# A fresh install with --prod keeps compilers, test tools and the Prisma CLI out of the runtime images.
FROM slim-base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/server-core/package.json packages/server-core/
COPY packages/legacy-domain/package.json packages/legacy-domain/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter "@sqms/api..." --filter "@sqms/worker..."
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/server-core/dist packages/server-core/dist
COPY --from=build /repo/packages/legacy-domain/index.* packages/legacy-domain/
COPY --from=build /repo/packages/legacy-domain/standard-plans.json packages/legacy-domain/standard-plans.json
COPY --from=build /repo/packages/legacy-domain/services packages/legacy-domain/services
COPY --from=build /repo/packages/legacy-domain/assets packages/legacy-domain/assets

# ---------------------------------------------------------------------------------------------- api
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo /app
COPY --from=build --chown=node:node /repo/apps/api/dist /app/apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------------------------- worker
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo /app
COPY --from=build --chown=node:node /repo/apps/worker/dist /app/apps/worker/dist
USER node
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------------------------- web
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Next.js standalone output mirrors the monorepo layout (outputFileTracingRoot = repository root).
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------------------------- migrate
# One-shot job: applies migrations with the DDL-capable account, then (idempotently) the reference seed.
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /repo
COPY infra/docker/migrate.sh /usr/local/bin/sqms-migrate
RUN chmod 0755 /usr/local/bin/sqms-migrate
USER node
CMD ["sqms-migrate"]

# ---------------------------------------------------------------------------------------------- render
# Render builds a Dockerfile without a target, but passes each service's environment variables as build args, so
# render.yaml sets SQMS_SERVICE to one of the stages below. sqms-env builds the connection URLs from the separate
# values a Blueprint can provide (infra/render/sqms-env.sh).
#
# Render runs migrations as the API's pre-deploy command, so the API image also carries the database package with
# the Prisma CLI and its schema engine, plus the OpenSSL 3 libraries the engine needs, which the slim base lacks.
FROM build AS render-db-tools
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    pnpm --filter @sqms/db deploy --legacy --store-dir /pnpm/store /opt/sqms-db \
 && (cd /opt/sqms-db && ./node_modules/.bin/prisma --version) \
 && mkdir -p /opt/openssl \
 && cp --parents /usr/lib/*-linux-gnu/libssl.so.3 /usr/lib/*-linux-gnu/libcrypto.so.3 /opt/openssl/

FROM api AS api-render
COPY --from=render-db-tools /opt/openssl/ /
COPY --from=render-db-tools --chown=node:node /opt/sqms-db /opt/sqms-db
COPY --chmod=0755 infra/docker/migrate.sh /usr/local/bin/sqms-migrate
COPY --chmod=0755 infra/render/sqms-env.sh /usr/local/bin/sqms-env
ENV SQMS_DB_PACKAGE_DIR=/opt/sqms-db SQMS_API_DIR=/app/apps/api
CMD ["sqms-env", "node", "dist/main.js"]

FROM worker AS worker-render
COPY --chmod=0755 infra/render/sqms-env.sh /usr/local/bin/sqms-env
CMD ["sqms-env", "node", "dist/main.js"]

FROM ${SQMS_SERVICE} AS selected
