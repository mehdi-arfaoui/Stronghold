$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

$envFile = Join-Path $rootDir ".env"

function Ensure-EnvSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key
  )

  if (-not (Test-Path $envFile)) {
    return
  }

  $content = Get-Content $envFile
  $line = $content | Where-Object { $_ -match "^$Key=" } | Select-Object -Last 1
  $currentValue = if ($line) { ($line -replace "^$Key=", "").Trim() } else { "" }

  if (-not [string]::IsNullOrWhiteSpace($currentValue) -and -not $currentValue.StartsWith("CHANGE_ME") -and $currentValue -ne "example") {
    return
  }

  $generatedValue = node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  $replacement = "$Key=$generatedValue"

  if ($line) {
    $updated = $content | ForEach-Object {
      if ($_ -match "^$Key=") { $replacement } else { $_ }
    }
    Set-Content -Path $envFile -Value $updated
  } else {
    Add-Content -Path $envFile -Value $replacement
  }

  Write-Host "Generated $Key in .env"
}

Ensure-EnvSecret -Key "JWT_SECRET"

Write-Host "[1/6] Starting postgres + redis..."
docker compose up -d postgres redis

Write-Host "[2/6] Waiting for postgres healthcheck..."
$postgresContainerId = docker compose ps -q postgres
if ([string]::IsNullOrWhiteSpace($postgresContainerId)) {
  throw "Postgres container not found."
}

$isHealthy = $false
for ($i = 1; $i -le 60; $i++) {
  $status = docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' $postgresContainerId 2>$null
  if ($status -eq "healthy") {
    $isHealthy = $true
    Write-Host "Postgres is healthy."
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $isHealthy) {
  docker compose ps
  throw "Postgres did not become healthy in time."
}

Write-Host "[3/6] Running Prisma migrate deploy..."
Push-Location backend
npx prisma migrate deploy
Pop-Location

Write-Host "[4/6] Running db:seed..."
Push-Location backend
npm run db:seed
Pop-Location

Write-Host "[5/6] Running seed:demo..."
Push-Location backend
npm run seed:demo
Pop-Location

Write-Host "[6/6] Starting all services..."
docker compose up -d

Write-Host "Setup completed."
docker compose ps
