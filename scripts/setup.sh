#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Review DB_PASSWORD before exposing the stack."
fi

echo "Building Stronghold self-hosted baseline..."
docker compose build

echo "Starting Stronghold self-hosted baseline..."
docker compose up -d

echo "Current status:"
docker compose ps
