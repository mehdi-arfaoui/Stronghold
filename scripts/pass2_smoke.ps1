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
    $json = $Body | ConvertTo-Json -Depth 60 -Compress
    [System.IO.File]::WriteAllText($requestFile, $json, (New-Object System.Text.UTF8Encoding($false)))

    $status = & curl.exe -s -X $Method -H "x-api-key: $apiKey" -H "Content-Type: application/json" --data-binary "@$requestFile" -o $responseFile -w "%{http_code}" $url
    Remove-Item -Force $requestFile
  }
  else {
    $status = & curl.exe -s -X $Method -H "x-api-key: $apiKey" -o $responseFile -w "%{http_code}" $url
  }

  $raw = Get-Content -Path $responseFile -Raw
  Remove-Item -Force $responseFile

  $parsed = $null
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $raw }
  }

  return [pscustomobject]@{
    status = [int]$status
    body = $parsed
    raw = $raw
  }
}

# Wait backend ready
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $ping = Invoke-Api -Method "GET" -Path "/financial/summary"
    if ($ping.status -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 1000
}

$checks = @()
$ids = [ordered]@{}

if (-not $ready) {
  [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    error = "Backend not ready"
  } | ConvertTo-Json -Depth 20
  exit 1
}

# 1) Recommendations + ROI payload used by Recommendations page
$reco = Invoke-Api -Method "GET" -Path "/recommendations/landing-zone"
$roiStatus = $null
$roiPass = $false
$recoCount = 0
$roiBreakdownCount = 0
if ($reco.status -eq 200 -and $reco.body -is [System.Array]) {
  $recoCount = $reco.body.Count
  $payloadRecs = @()
  foreach ($r in ($reco.body | Select-Object -First 8)) {
    $strategyRaw = [string]$r.strategy
    $strategy = $null
    if (-not [string]::IsNullOrWhiteSpace($strategyRaw)) {
      if ($strategyRaw -eq 'backup') { $strategy = 'backup_restore' }
      else { $strategy = $strategyRaw.Replace('-', '_') }
    }

    $targets = @()
    if ($r.nodeId) { $targets = @([string]$r.nodeId) }
    elseif ($r.affectedNodeIds -is [System.Array]) { $targets = @($r.affectedNodeIds | ForEach-Object { [string]$_ }) }

    $payloadRecs += [pscustomobject]@{
      recommendationId = [string]$r.id
      strategy = $strategy
      targetNodes = $targets
      monthlyCost = if ($r.estimatedCost) { [double]$r.estimatedCost } else { 500 }
    }
  }

  $roi = Invoke-Api -Method "POST" -Path "/financial/calculate-roi" -Body @{
    currency = "EUR"
    recommendations = $payloadRecs
  }
  $roiStatus = $roi.status
  if ($roi.status -eq 200) {
    $roiBreakdownCount = @($roi.body.breakdownByRecommendation).Count
    $roiPass = (
      $null -ne $roi.body.currentALE -and
      $null -ne $roi.body.projectedALE -and
      $null -ne $roi.body.annualRemediationCost -and
      $null -ne $roi.body.roiPercent -and
      $null -ne $roi.body.paybackMonths -and
      $roiBreakdownCount -gt 0
    )
  }
}
$checks += [pscustomobject]@{
  check = "recommendations_roi_summary_payload"
  pass = $roiPass
  recommendationsCount = $recoCount
  roiStatus = $roiStatus
  roiBreakdownCount = $roiBreakdownCount
}

# 2) BIA cost/h + node financial override flow
$biaBefore = Invoke-Api -Method "GET" -Path "/bia-resilience/entries"
$overridePass = $false
$overrideNodeId = $null
$overrideValue = $null
if ($biaBefore.status -eq 200) {
  $entries = @($biaBefore.body.entries)
  $target = $entries | Where-Object { -not $_.financialIsOverride -and $_.nodeId } | Select-Object -First 1
  if (-not $target) { $target = $entries | Where-Object { $_.nodeId } | Select-Object -First 1 }

  if ($target) {
    $overrideNodeId = [string]$target.nodeId
    $baseCost = [double]($target.financialImpactPerHour)
    if (-not (-not [double]::IsNaN($baseCost) -and -not [double]::IsInfinity($baseCost)) -or $baseCost -lt 1) { $baseCost = 4200 }
    $overrideValue = [math]::Round($baseCost + 123)

    $putOverride = Invoke-Api -Method "PUT" -Path "/financial/node/$overrideNodeId/override" -Body @{
      customCostPerHour = $overrideValue
      justification = "Smoke test Pass 2 BIA override"
      validatedBy = "qa-smoke"
    }

    $biaAfter = Invoke-Api -Method "GET" -Path "/bia-resilience/entries"
    $updated = @($biaAfter.body.entries) | Where-Object { $_.nodeId -eq $overrideNodeId } | Select-Object -First 1

    $overridePass = (
      $putOverride.status -eq 200 -and
      $null -ne $updated -and
      [bool]$updated.financialIsOverride -eq $true -and
      [double]$updated.financialOverride.customCostPerHour -eq [double]$overrideValue
    )
  }
}
$ids.overrideNodeId = $overrideNodeId
$checks += [pscustomobject]@{
  check = "bia_cost_column_override_roundtrip"
  pass = $overridePass
  nodeId = $overrideNodeId
  customCostPerHour = $overrideValue
}

# 3) Drift event financial impact enrichment
$driftEvents = Invoke-Api -Method "GET" -Path "/drift/events?status=open&limit=20"
if ($driftEvents.status -eq 200 -and @($driftEvents.body.events).Count -eq 0) {
  [void](Invoke-Api -Method "POST" -Path "/drift/check" -Body @{ comparisonMode = "baseline" })
  Start-Sleep -Milliseconds 1200
  $driftEvents = Invoke-Api -Method "GET" -Path "/drift/events?limit=20"
}
$sampleDrift = if ($driftEvents.status -eq 200) { @($driftEvents.body.events) | Select-Object -First 1 } else { $null }
$driftPass = (
  $driftEvents.status -eq 200 -and
  $null -ne $sampleDrift -and
  $null -ne $sampleDrift.financialImpact -and
  $null -ne $sampleDrift.financialImpact.financialImpact -and
  $sampleDrift.financialImpact.financialImpact.additionalAnnualRisk -ne $null -and
  -not [string]::IsNullOrWhiteSpace([string]$sampleDrift.financialImpact.financialImpact.explanation)
)
$ids.driftEventId = if ($sampleDrift) { [string]$sampleDrift.id } else { $null }
$checks += [pscustomobject]@{
  check = "drift_event_financial_badge_data"
  pass = $driftPass
  driftStatus = $driftEvents.status
  driftEventId = $ids.driftEventId
  additionalAnnualRisk = if ($sampleDrift) { $sampleDrift.financialImpact.financialImpact.additionalAnnualRisk } else { $null }
}

# 4) Simulation financial total for summary / war room
$summary = Invoke-Api -Method "GET" -Path "/financial/summary"
$simNodeId = $null
if ($summary.status -eq 200 -and @($summary.body.topSPOFs).Count -gt 0) {
  $simNodeId = [string]$summary.body.topSPOFs[0].nodeId
}
if ([string]::IsNullOrWhiteSpace($simNodeId)) {
  $templates = Invoke-Api -Method "GET" -Path "/simulations/templates"
  if ($templates.status -eq 200 -and @($templates.body.dynamicOptions.allNodes).Count -gt 0) {
    $simNodeId = [string]$templates.body.dynamicOptions.allNodes[0]
  }
}

$sim = $null
$simPass = $false
if (-not [string]::IsNullOrWhiteSpace($simNodeId)) {
  $sim = Invoke-Api -Method "POST" -Path "/simulations" -Body @{
    scenarioType = "custom"
    name = "Pass 2 smoke financial scenario"
    params = @{ nodes = @($simNodeId) }
  }

  if ($sim.status -eq 200) {
    $loss = [double]$sim.body.metrics.estimatedFinancialLoss
    $direct = @($sim.body.directlyAffected).Count
    $cascade = @($sim.body.cascadeImpacted).Count
    $simPass = (
      $null -ne $sim.body.metrics -and
      $loss -gt 0 -and
      ($direct + $cascade) -gt 0
    )
    $ids.simulationId = [string]$sim.body.id
  }
}
$checks += [pscustomobject]@{
  check = "simulation_total_cost_present"
  pass = $simPass
  nodeId = $simNodeId
  simulationStatus = if ($sim) { $sim.status } else { $null }
  estimatedFinancialLoss = if ($sim -and $sim.status -eq 200) { $sim.body.metrics.estimatedFinancialLoss } else { $null }
}

[pscustomobject]@{
  generatedAt = (Get-Date).ToString("o")
  ids = [pscustomobject]$ids
  checks = $checks
} | ConvertTo-Json -Depth 40

