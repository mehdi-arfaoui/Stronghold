$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

Write-Host "Stopping compose stack and removing volumes..."
docker compose down -v --remove-orphans

Write-Host "Cleaning Docker build cache..."
docker builder prune -f

Write-Host "Cleaning workspace build output..."
if (Test-Path "packages/core/dist") { Remove-Item -Recurse -Force "packages/core/dist" }
if (Test-Path "packages/cli/dist") { Remove-Item -Recurse -Force "packages/cli/dist" }
if (Test-Path "packages/server/dist") { Remove-Item -Recurse -Force "packages/server/dist" }
if (Test-Path "packages/web/dist") { Remove-Item -Recurse -Force "packages/web/dist" }

Write-Host "Rebuilding and restarting..."
docker compose build
docker compose up -d

docker compose ps
