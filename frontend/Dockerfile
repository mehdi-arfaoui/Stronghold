# syntax=docker/dockerfile:1.6
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --fund=false
ARG VITE_BACKEND_URL
ARG VITE_API_URL
ARG VITE_API_KEY
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_KEY=${VITE_API_KEY}
COPY . .
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
