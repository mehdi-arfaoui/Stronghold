#!/bin/sh
set -e

npm install
npx prisma generate

if ! npx prisma migrate deploy; then
  echo "Prisma migrate deploy failed. Resetting database for local dev..."
  npx prisma migrate reset --force --skip-seed
fi

node prisma/seed.cjs
npm run dev
