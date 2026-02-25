# Stronghold - Full reset (DB + cache + builds + browser storage)

param(
  [switch]$LoadBaseSeed,
  [switch]$LoadDemoSeed
)

$ErrorActionPreference = "Stop"

if ($LoadDemoSeed -and -not $LoadBaseSeed) {
  $LoadBaseSeed = $true
}

Write-Host "Stopping all containers..."
docker compose down -v --remove-orphans

Write-Host "Removing orphan volumes..."
docker volume ls -q --filter name=stronghold | ForEach-Object { docker volume rm $_ }

Write-Host "Cleaning Docker build cache..."
docker builder prune -f

Write-Host "Cleaning frontend build cache..."
if (Test-Path "frontend/dist") { Remove-Item -Recurse -Force "frontend/dist" }
if (Test-Path "frontend/node_modules/.vite") { Remove-Item -Recurse -Force "frontend/node_modules/.vite" }
if (Test-Path "frontend/.vite") { Remove-Item -Recurse -Force "frontend/.vite" }

Write-Host "Cleaning backend build cache..."
if (Test-Path "backend/dist") { Remove-Item -Recurse -Force "backend/dist" }

Write-Host "Restarting fresh..."
docker compose up -d postgres redis
Write-Host "Waiting for Postgres healthcheck..."
Start-Sleep -Seconds 8

Push-Location backend
Write-Host "Running migrations..."
npx prisma migrate reset --force --skip-seed

if ($LoadBaseSeed) {
  Write-Host "Seeding base data..."
  npm run db:seed
} else {
  Write-Host "Skipping base seed (default reset = migrations only)."
}

if ($LoadDemoSeed) {
  Write-Host "Seeding demo data..."
  npm run seed:demo
} else {
  Write-Host "Skipping demo seed (default)."
}
Pop-Location

Write-Host "Starting all services..."
docker compose up -d

Write-Host ""
Write-Host "====================================="
Write-Host " RESET COMPLETE"
Write-Host " N'oubliez pas de vider le localStorage du navigateur :"
Write-Host " F12 > Application > Local Storage > Supprimer les entrees stronghold_*"
Write-Host "====================================="
