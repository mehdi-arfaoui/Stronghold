#!/bin/bash
set -e

echo "Stopping all containers..."
docker compose down -v --remove-orphans

echo "Removing orphan volumes..."
docker volume ls -q --filter name=stronghold | xargs -r docker volume rm

echo "Cleaning Docker build cache..."
docker builder prune -f

echo "Cleaning frontend build cache..."
rm -rf frontend/dist frontend/node_modules/.vite frontend/.vite

echo "Cleaning backend build cache..."
rm -rf backend/dist

echo "Restarting fresh..."
docker compose up -d postgres redis
echo "Waiting for Postgres healthcheck..."
sleep 8

cd backend
echo "Running migrations..."
npx prisma migrate reset --force
echo "Seeding base data..."
npm run db:seed
echo "Seeding demo data..."
npm run seed:demo
cd ..

echo "Starting all services..."
docker compose up -d

echo ""
echo "====================================="
echo " RESET COMPLETE"
echo " N'oubliez pas de vider le localStorage du navigateur :"
echo " F12 > Application > Local Storage > Supprimer les entrees stronghold_*"
echo "====================================="
