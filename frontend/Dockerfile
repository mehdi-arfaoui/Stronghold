# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --fund=false --ignore-scripts

FROM deps AS source
WORKDIR /app
ARG VITE_API_URL
ARG VITE_API_KEY
ARG VITE_APP_VERSION
ARG VITE_ENV
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_KEY=${VITE_API_KEY}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV VITE_ENV=${VITE_ENV}
COPY index.html ./
COPY vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY tailwind.config.ts postcss.config.js components.json ./
COPY public ./public
COPY src ./src

FROM source AS build-client
ENV BUILD_TARGET=client
RUN rm -rf src/pages/demo
RUN npm run build

FROM source AS build-internal
ENV BUILD_TARGET=internal
RUN npm run build

FROM nginx:alpine AS client
COPY --from=build-client /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]

FROM nginx:alpine AS internal
COPY --from=build-internal /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
