# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/server/prisma packages/server/prisma
COPY packages/web/package.json packages/web/package.json

RUN npm ci

FROM dependencies AS build-core
COPY packages/core packages/core
RUN npm run build --workspace=packages/core

FROM build-core AS build-server
COPY packages/server packages/server
RUN npm run db:generate --workspace=packages/server
RUN npm run build --workspace=packages/server

FROM build-core AS build-web
COPY packages/web packages/web
RUN npm run build --workspace=packages/web

FROM base AS server
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/server/prisma packages/server/prisma
COPY packages/web/package.json packages/web/package.json

RUN npm ci --omit=dev --workspace=packages/core --workspace=packages/server
RUN npm run db:generate --workspace=packages/server

COPY --from=build-core /app/packages/core/dist packages/core/dist
COPY --from=build-server /app/packages/server/dist packages/server/dist
COPY --chmod=755 docker/start-server.sh /app/docker/start-server.sh

RUN chown -R node:node /app

USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker/start-server.sh"]

FROM nginx:1.27-alpine AS web
COPY packages/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build-web /app/packages/web/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
