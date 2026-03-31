#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Stopping compose stack and removing volumes..."
docker compose down -v --remove-orphans

echo "Cleaning Docker build cache..."
docker builder prune -f

echo "Cleaning workspace build output..."
rm -rf packages/core/dist packages/cli/dist packages/server/dist packages/web/dist

echo "Rebuilding and restarting..."
docker compose build
docker compose up -d

docker compose ps
