# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS base
RUN apk add --no-cache \
    ca-certificates \
    nmap \
    nmap-scripts \
    net-snmp-tools \
    openssl \
    tesseract-ocr \
    wget
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --fund=false --ignore-scripts

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --fund=false --ignore-scripts

FROM deps AS source
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.client.json ./
COPY config ./config
COPY src ./src
COPY scripts ./scripts
RUN sed -i 's/\r$//' scripts/migrate-and-seed.sh \
    && chmod +x scripts/migrate-and-seed.sh

FROM source AS build-client
ENV BUILD_TARGET=client
RUN rm -rf src/demo
RUN npm run build

FROM source AS build-internal
ENV BUILD_TARGET=internal
RUN npm run build

FROM base AS migrate
RUN apk add --no-cache bash
COPY --from=build-internal /app/package.json ./package.json
COPY --from=build-internal /app/package-lock.json ./package-lock.json
COPY --from=build-internal /app/node_modules ./node_modules
COPY --from=build-internal /app/prisma ./prisma
COPY --from=build-internal /app/scripts ./scripts
CMD ["bash", "scripts/migrate-and-seed.sh"]

FROM base AS client
ENV NODE_ENV=production
ENV BUILD_TARGET=client
COPY --from=build-client /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build-client /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build-client /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build-client /app/dist ./dist
COPY --from=build-client /app/prisma ./prisma
COPY --from=build-client /app/config ./config
EXPOSE 4000
CMD ["node", "dist/index.js"]

FROM base AS internal
ENV NODE_ENV=production
ENV BUILD_TARGET=internal
COPY --from=build-internal /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build-internal /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build-internal /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build-internal /app/dist ./dist
COPY --from=build-internal /app/prisma ./prisma
COPY --from=build-internal /app/config ./config
COPY --from=build-internal /app/src/demo ./src/demo
EXPOSE 4000
CMD ["node", "dist/index.js"]
