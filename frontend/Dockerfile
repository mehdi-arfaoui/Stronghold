# syntax=docker/dockerfile:1.6

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
# Package manifests (changent rarement)
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --fund=false

# Stage 2: Build
FROM deps AS build
WORKDIR /app
ARG VITE_API_URL
ARG VITE_APP_VERSION
ARG VITE_ENV
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV VITE_ENV=${VITE_ENV}
# Fichiers de configuration (changent rarement)
COPY vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY tailwind.config.ts postcss.config.js ./
COPY eslint.config.js ./
# HTML entry point (change rarement)
COPY index.html ./
# Assets statiques (changent occasionnellement)
COPY public ./public
# Code source (change souvent) — EN DERNIER
COPY src ./src
RUN npm run build

# Stage 3: Runtime
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
