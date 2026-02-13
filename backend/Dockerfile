# syntax=docker/dockerfile:1.6

# Stage 1: System dependencies (cached très longtemps)
FROM node:20-alpine AS base
RUN apk add --no-cache \
    ca-certificates \
    nmap \
    nmap-scripts \
    net-snmp-tools \
    openssl \
    tesseract-ocr \
    wget \
    && rm -rf /var/cache/apk/*

# Stage 2: Node dependencies
FROM base AS deps
WORKDIR /app
# Package manifests (changent rarement)
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --fund=false --ignore-scripts

# Stage 3: Build
FROM deps AS build
WORKDIR /app
# Prisma schema (change occasionnellement)
COPY prisma ./prisma
# Fichiers de configuration (changent rarement)
COPY tsconfig.json ./
# Code source (change souvent) — EN DERNIER
COPY src ./src
COPY scripts ./scripts
RUN sed -i 's/\r$//' scripts/migrate-and-seed.sh \
    && chmod +x scripts/migrate-and-seed.sh
RUN npx prisma generate
RUN npm run build

# Stage 4: Production dependencies
FROM build AS prod-deps
RUN npm prune --production

# Stage 5: Migration
FROM base AS migrate
WORKDIR /app
RUN apk add --no-cache bash
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
CMD ["bash", "scripts/migrate-and-seed.sh"]

# Stage 6: Runtime
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
EXPOSE 4000
CMD ["node", "dist/index.js"]
