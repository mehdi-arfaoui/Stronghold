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

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --fund=false --ignore-scripts

FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --fund=false --ignore-scripts

FROM deps AS build
WORKDIR /app
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY config ./config
COPY src ./src
COPY scripts ./scripts
RUN sed -i 's/\r$//' scripts/migrate-and-seed.sh \
    && chmod +x scripts/migrate-and-seed.sh
RUN npm run build

FROM base AS migrate
WORKDIR /app
RUN apk add --no-cache bash
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
CMD ["bash", "scripts/migrate-and-seed.sh"]

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/config ./config
EXPOSE 4000
CMD ["node", "dist/index.js"]
