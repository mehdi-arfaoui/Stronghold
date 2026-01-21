# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim AS deps
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

FROM build AS migrate
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
CMD ["bash", "scripts/migrate-and-seed.sh"]

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nmap \
        snmp \
        tesseract-ocr \
        wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
RUN npm prune --omit=dev
EXPOSE 4000
CMD ["node", "dist/index.js"]
