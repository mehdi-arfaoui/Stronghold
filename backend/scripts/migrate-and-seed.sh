#!/usr/bin/env bash
set -euo pipefail

echo "Running Prisma migrations..."
npx prisma migrate deploy

if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "Seeding database..."
  node prisma/seed.cjs
else
  echo "Skipping seed (SEED_ON_START=false)."
fi
