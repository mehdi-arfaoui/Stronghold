#!/bin/sh
set -e

npm install
npx prisma generate

if ! npx prisma migrate deploy; then
  echo "Prisma migrate deploy failed. Attempting to resolve failed migrations..."
  FAILED_MIGRATIONS=$(node -e "const { execSync } = require('child_process');\ntry {\n  const out = execSync('npx prisma migrate status --json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();\n  const data = JSON.parse(out);\n  const failed = data.failedMigrationNames || [];\n  process.stdout.write(failed.join(' '));\n} catch (err) {\n  process.stdout.write('');\n}")

  if [ -n "$FAILED_MIGRATIONS" ]; then
    for migration in $FAILED_MIGRATIONS; do
      npx prisma migrate resolve --rolled-back "$migration"
    done
  fi

  echo "Retrying prisma migrate deploy..."
  if ! npx prisma migrate deploy; then
    echo "Prisma migrate deploy failed again. Resetting database for local dev..."
    npx prisma migrate reset --force --skip-seed
  fi
fi

node prisma/seed.cjs
npm run dev
