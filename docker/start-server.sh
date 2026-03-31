#!/bin/sh
set -eu

PRISMA_BIN="/app/node_modules/.bin/prisma"
PRISMA_SCHEMA="/app/packages/server/prisma/schema.prisma"

if [ ! -x "$PRISMA_BIN" ]; then
  echo "Prisma CLI not found at $PRISMA_BIN" >&2
  exit 1
fi

echo "Applying Prisma migrations..."
"$PRISMA_BIN" migrate deploy --schema "$PRISMA_SCHEMA"

echo "Starting Stronghold server..."
exec node /app/packages/server/dist/index.js
