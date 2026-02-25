#!/usr/bin/env bash
set -euo pipefail

echo "Running Prisma migrations..."
npx prisma migrate deploy

if [ "${SEED_ON_START:-false}" = "true" ] || [ "${LOAD_DEMO_SEED:-false}" = "true" ]; then
  echo "Seeding database..."
  node prisma/seed.cjs
else
  echo "Skipping seed (SEED_ON_START=false)."
fi

if [ "${LOAD_DEMO_SEED:-false}" = "true" ]; then
  echo "Seeding demo data..."
  npx tsx prisma/seed-demo.ts
else
  echo "Skipping demo seed (LOAD_DEMO_SEED=false)."
fi
