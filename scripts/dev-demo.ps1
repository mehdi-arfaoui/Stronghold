param(
  [switch]$Bootstrap,
  [switch]$SeedDemo,
  [switch]$SkipBootstrap
)

$ErrorActionPreference = "Stop"

if ($SkipBootstrap) {
  $Bootstrap = $false
} elseif (-not $PSBoundParameters.ContainsKey("Bootstrap")) {
  $Bootstrap = $true
}

if ($SeedDemo -and -not $Bootstrap) {
  $Bootstrap = $true
}

$rootDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"
$backendEnvFile = Join-Path $backendDir ".env"

function Quote-Single {
  param([Parameter(Mandatory = $true)][string]$Value)
  return $Value.Replace("'", "''")
}

function Start-DemoShell {
  param(
    [Parameter(Mandatory = $true)][string]$WindowTitle,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string[]]$EnvLines,
    [Parameter(Mandatory = $true)][string]$CommandLine
  )

  $safeTitle = Quote-Single -Value $WindowTitle
  $safeCwd = Quote-Single -Value $WorkingDirectory
  $scriptLines = @(
    "`$Host.UI.RawUI.WindowTitle = '$safeTitle'"
    "Set-Location '$safeCwd'"
  ) + $EnvLines + @($CommandLine)
  $scriptBlock = $scriptLines -join "; "

  Start-Process -FilePath "powershell" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $scriptBlock
  ) | Out-Null
}

function Get-EnvFileValue {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Key
  )

  if (-not (Test-Path $FilePath)) {
    return $null
  }

  $line = Get-Content $FilePath |
    Where-Object { $_ -match "^\s*$([Regex]::Escape($Key))\s*=" } |
    Select-Object -Last 1

  if (-not $line) {
    return $null
  }

  $value = ($line -replace "^\s*$([Regex]::Escape($Key))\s*=\s*", "").Trim()
  if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }

  return $value
}

function Test-TcpPort {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne(1000, $false)) {
      $client.Close()
      return $false
    }
    $client.EndConnect($asyncResult)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-TcpPort {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutSeconds = 90
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort -HostName $HostName -Port $Port) {
      return $true
    }
    Start-Sleep -Seconds 1
  }

  return $false
}

Set-Location $rootDir

if ($Bootstrap) {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if ($dockerCommand) {
    Write-Host "[bootstrap] Starting postgres + redis (docker compose)..."
    docker compose up -d postgres redis
  } else {
    Write-Host "[bootstrap] Docker not found, assuming local postgres/redis are already running."
  }

  Write-Host "[bootstrap] Waiting for postgres on localhost:5432..."
  if (-not (Wait-TcpPort -HostName "localhost" -Port 5432 -TimeoutSeconds 90)) {
    throw "Postgres is not reachable on localhost:5432. Start your database, then rerun the script."
  }

  Write-Host "[bootstrap] Running backend migrations + base seed..."
  Push-Location $backendDir
  npx prisma migrate deploy
  npm run db:seed

  if ($SeedDemo) {
    Write-Host "[bootstrap] Running demo seed..."
    $env:BUILD_TARGET = "internal"
    $env:APP_ENV = "demo"
    $env:ALLOW_DEMO_SEED = "true"
    $env:NODE_ENV = "development"
    npm run seed:demo
  }

  Pop-Location
}

$backendEnv = @(
  "`$env:BUILD_TARGET='internal'",
  "`$env:APP_ENV='demo'",
  "`$env:ALLOW_DEMO_SEED='true'",
  "`$env:NODE_ENV='development'"
)

$frontendEnv = @(
  "`$env:BUILD_TARGET='internal'",
  "`$env:VITE_ENV='demo'"
)

$seedApiKey = Get-EnvFileValue -FilePath $backendEnvFile -Key "SEED_API_KEY"
if ($seedApiKey) {
  $safeSeedApiKey = Quote-Single -Value $seedApiKey
  $frontendEnv += "`$env:VITE_API_KEY='$safeSeedApiKey'"
}

Write-Host "[launch] Starting backend demo terminal..."
Start-DemoShell `
  -WindowTitle "Stronghold Backend Demo" `
  -WorkingDirectory $backendDir `
  -EnvLines $backendEnv `
  -CommandLine "npm run dev"

Start-Sleep -Seconds 1

Write-Host "[launch] Starting frontend demo terminal..."
Start-DemoShell `
  -WindowTitle "Stronghold Frontend Demo" `
  -WorkingDirectory $frontendDir `
  -EnvLines $frontendEnv `
  -CommandLine "npm run dev"

Write-Host ""
Write-Host "Demo mode started in two terminals:"
Write-Host " - Backend:  http://localhost:4000/health/live"
Write-Host " - Frontend: http://localhost:3000"
Write-Host ""
Write-Host "Usage:"
Write-Host " - .\scripts\dev-demo.ps1"
Write-Host " - .\scripts\dev-demo.ps1 -SkipBootstrap"
Write-Host " - .\scripts\dev-demo.ps1 -Bootstrap -SeedDemo"
