# syntax=docker/dockerfile:1.6
FROM node:20-bullseye AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --fund=false

FROM deps AS build
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./
RUN sed -i 's/\r$//' scripts/migrate-and-seed.sh \
    && chmod +x scripts/migrate-and-seed.sh
RUN npx prisma generate
RUN npm run build

FROM build AS prod-deps
RUN npm prune --production

FROM node:20-bullseye AS migrate
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        libssl1.1 \
        openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
CMD ["bash", "scripts/migrate-and-seed.sh"]

FROM node:20-bullseye AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl1.1 \
        nmap \
        openssl \
        snmp \
        tesseract-ocr \
        wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
EXPOSE 4000
CMD ["node", "dist/index.js"]
