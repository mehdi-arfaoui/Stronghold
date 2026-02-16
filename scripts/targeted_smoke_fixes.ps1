$ErrorActionPreference = "Stop"
$base = "http://localhost:4000"
$apiKey = "dev_seed_api_key_for_local_runs"

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $false)]$Body
  )

  $url = "$base$Path"
  $responseFile = [System.IO.Path]::GetTempFileName()

  if ($PSBoundParameters.ContainsKey("Body")) {
    $requestFile = [System.IO.Path]::GetTempFileName()
    $json = $Body | ConvertTo-Json -Depth 40 -Compress
    [System.IO.File]::WriteAllText(
      $requestFile,
      $json,
      (New-Object System.Text.UTF8Encoding($false))
    )

    $status = & curl.exe -s `
      -X $Method `
      -H "x-api-key: $apiKey" `
      -H "Content-Type: application/json" `
      --data-binary "@$requestFile" `
      -o $responseFile `
      -w "%{http_code}" `
      $url

    Remove-Item -Force $requestFile
  }
  else {
    $status = & curl.exe -s `
      -X $Method `
      -H "x-api-key: $apiKey" `
      -o $responseFile `
      -w "%{http_code}" `
      $url
  }

  $raw = Get-Content -Path $responseFile -Raw
  Remove-Item -Force $responseFile

  Start-Sleep -Milliseconds 180

  $parsed = $null
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $raw }
  }

  [pscustomobject]@{
    status = [int]$status
    body   = $parsed
    raw    = $raw
  }
}

$results = @()

$runbookGuard = Invoke-Api -Method "POST" -Path "/runbooks/generate" -Body @{}
$results += [pscustomobject]@{
  test = "runbooks_generate_requires_simulation_or_scenario"
  status = $runbookGuard.status
  pass = ($runbookGuard.status -eq 400 -and [string]$runbookGuard.body.error -eq "simulationId or scenarioId is required")
  body = $runbookGuard.raw
}

$simulation = Invoke-Api -Method "POST" -Path "/simulations" -Body @{
  scenarioType = "failed-deployment"
  name = "Targeted smoke simulation"
  params = @{
    hasCanary = $false
    rollbackReady = $true
  }
}
$simulationId = if ($simulation.status -eq 200) { [string]$simulation.body.id } else { "" }

$runbookCreate = Invoke-Api -Method "POST" -Path "/runbooks/generate" -Body @{
  simulationId = $simulationId
  title = "Targeted smoke runbook"
  responsible = "SRE Lead"
  accountable = "CTO"
  consulted = "SecOps"
  informed = "Business Owner"
}
$runbookId = if ($runbookCreate.status -eq 201) { [string]$runbookCreate.body.runbook.id } else { "" }

$exerciseCreate = if (-not [string]::IsNullOrWhiteSpace($runbookId)) {
  Invoke-Api -Method "POST" -Path "/pra-exercises" -Body @{
    title = "Targeted PRA exercise"
    runbookId = $runbookId
    scheduledAt = (Get-Date).AddDays(2).ToString("o")
    predictedRTO = 120
    predictedRPO = 30
  }
} else { $null }
$exerciseId = if ($exerciseCreate -and $exerciseCreate.status -eq 201) { [string]$exerciseCreate.body.id } else { "" }

$completeExercise = if (-not [string]::IsNullOrWhiteSpace($exerciseId)) {
  Invoke-Api -Method "PATCH" -Path "/pra-exercises/$exerciseId" -Body @{
    status = "completed"
    outcome = "success"
    actualRTO = 95
    actualRPO = 20
    duration = 90
    findings = @{
      notes = "Exercise completed"
    }
  }
} else { $null }

$doublePatch = if (-not [string]::IsNullOrWhiteSpace($exerciseId)) {
  Invoke-Api -Method "PATCH" -Path "/pra-exercises/$exerciseId" -Body @{
    status = "completed"
    outcome = "partial"
    actualRTO = 90
  }
} else { $null }

$results += [pscustomobject]@{
  test = "pra_exercise_double_patch_conflict"
  status = if ($doublePatch) { $doublePatch.status } else { $null }
  pass = (
    $null -ne $completeExercise -and
    $completeExercise.status -eq 200 -and
    $null -ne $doublePatch -and
    $doublePatch.status -eq 409 -and
    [string]$doublePatch.body.error -eq "Exercise already completed. Create a new exercise to record new results."
  )
  body = if ($doublePatch) { $doublePatch.raw } else { "no exercise created" }
}

[pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  ids = [pscustomobject]@{
    simulationId = $simulationId
    runbookId = $runbookId
    exerciseId = $exerciseId
  }
  checks = $results
} | ConvertTo-Json -Depth 20
