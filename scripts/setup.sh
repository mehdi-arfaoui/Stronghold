#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/6] Starting postgres + redis..."
docker compose up -d postgres redis

echo "[2/6] Waiting for postgres healthcheck..."
POSTGRES_CONTAINER_ID="$(docker compose ps -q postgres)"
if [[ -z "${POSTGRES_CONTAINER_ID}" ]]; then
  echo "Postgres container not found."
  exit 1
fi

for i in $(seq 1 60); do
  STATUS="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$POSTGRES_CONTAINER_ID" 2>/dev/null || true)"
  if [[ "${STATUS}" == "healthy" ]]; then
    echo "Postgres is healthy."
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "Postgres did not become healthy in time."
    docker compose ps
    exit 1
  fi
  sleep 2
done

echo "[3/6] Running Prisma migrate deploy..."
(
  cd backend
  npx prisma migrate deploy
)

echo "[4/6] Running db:seed..."
(
  cd backend
  npm run db:seed
)

echo "[5/6] Running seed:demo..."
(
  cd backend
  npm run seed:demo
)

echo "[6/6] Starting all services..."
docker compose up -d

echo "Setup completed."
docker compose ps
