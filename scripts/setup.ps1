$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example. Review DB_PASSWORD before exposing the stack."
}

Write-Host "Building Stronghold self-hosted baseline..."
docker compose build

Write-Host "Starting Stronghold self-hosted baseline..."
docker compose up -d

Write-Host "Current status:"
docker compose ps
