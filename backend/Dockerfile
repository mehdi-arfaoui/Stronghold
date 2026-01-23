# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
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

FROM node:20-alpine AS migrate
WORKDIR /app
RUN apk add --no-cache bash openssl ca-certificates
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
CMD ["bash", "scripts/migrate-and-seed.sh"]

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache \
        ca-certificates \
        nmap \
        net-snmp-tools \
        tesseract-ocr \
        wget
COPY --from=build /app/package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
EXPOSE 4000
CMD ["node", "dist/index.js"]
