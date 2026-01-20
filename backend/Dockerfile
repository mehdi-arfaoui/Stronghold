FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./
RUN npx prisma generate
RUN npm run build

FROM build AS migrate
RUN apt-get update && apt-get install -y bash && rm -rf /var/lib/apt/lists/*
CMD ["bash", "scripts/migrate-and-seed.sh"]

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
RUN npm prune --omit=dev
EXPOSE 4000
CMD ["node", "dist/index.js"]
