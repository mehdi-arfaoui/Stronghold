$ErrorActionPreference = 'Stop'

trap {
  Write-Error ("Validation failed on line {0}: {1}" -f $_.InvocationInfo.ScriptLineNumber, $_.Exception.Message)
  exit 1
}

$RootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $RootDir

try {
  Write-Host "==================================================="
  Write-Host "Stronghold Real AWS Validation"
  Write-Host "==================================================="

  Write-Host ""
  Write-Host "0. Building and linking the local CLI..."
  npm run build --workspace=packages/core | Out-Null
  npm run build --workspace=packages/cli | Out-Null
  npm link --workspace=packages/cli | Out-Null

  $GlobalBin = (npm bin -g).Trim()
  $CliCandidates = @(
    (Join-Path $GlobalBin 'stronghold.cmd'),
    (Join-Path $GlobalBin 'stronghold')
  )
  $CliBin = $CliCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $CliBin) {
    throw 'stronghold binary not found after npm link.'
  }
  Write-Host "   Using CLI: $CliBin"

  New-Item -ItemType Directory -Force -Path .stronghold | Out-Null

  Write-Host ""
  Write-Host "1. Checking AWS credentials..."
  aws sts get-caller-identity | Out-Null
  Write-Host "   Credentials OK"

  $Region = if ($env:AWS_DEFAULT_REGION) {
    $env:AWS_DEFAULT_REGION
  } elseif ($env:AWS_REGION) {
    $env:AWS_REGION
  } else {
    'eu-west-1'
  }
  Write-Host ""
  Write-Host "2. Using region: $Region"

  Write-Host ""
  Write-Host "3. Running scan..."
  & $CliBin scan --region $Region --output summary
  Write-Host "   Scan complete"

  if (-not (Test-Path '.stronghold/latest-scan.json')) {
    throw 'No scan results found at .stronghold/latest-scan.json.'
  }

  Write-Host ""
  Write-Host "4. Inspecting saved scan results..."
  $ResourceCount = node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync('./.stronghold/latest-scan.json','utf8')); console.log(s.nodes?.length ?? 0)"
  Write-Host "   Resources discovered: $ResourceCount"
  if ([int]$ResourceCount -eq 0) {
    Write-Warning 'No resources found. Check permissions and region.'
  }

  Write-Host ""
  Write-Host "5. Generating terminal report..."
  & $CliBin report --format terminal

  Write-Host ""
  Write-Host "6. Generating markdown report..."
  & $CliBin report --format markdown | Set-Content -Path .stronghold/report.md
  Write-Host "   Saved to .stronghold/report.md"

  Write-Host ""
  Write-Host "7. Generating DR plan..."
  & $CliBin plan generate --format yaml | Set-Content -Path .stronghold/drp.yaml
  Write-Host "   Saved to .stronghold/drp.yaml"

  Write-Host ""
  Write-Host "8. Generating runbook..."
  & $CliBin plan runbook --format yaml | Set-Content -Path .stronghold/runbook.yaml
  Write-Host "   Saved to .stronghold/runbook.yaml"

  Write-Host ""
  Write-Host "9. Validating the DR plan against the current scan..."
  & $CliBin plan validate --plan .stronghold/drp.yaml

  Write-Host ""
  Write-Host "10. Establishing drift baseline..."
  & $CliBin drift check --save-baseline
  Write-Host "   Baseline saved"

  Write-Host ""
  Write-Host "11. Generating IAM policy..."
  & $CliBin iam-policy | Set-Content -Path .stronghold/iam-policy.json
  Write-Host "   Saved to .stronghold/iam-policy.json"

  Write-Host ""
  Write-Host "12. Testing multi-region scan ($Region, us-east-1)..."
  try {
    & $CliBin scan --region "$Region,us-east-1" --output summary
  } catch {
    Write-Warning 'Multi-region scan failed. Additional permissions may be required in us-east-1.'
  }

  Write-Host ""
  Write-Host "13. Testing service filter (rds, aurora, s3)..."
  & $CliBin scan --region $Region --services rds,aurora,s3 --output summary

  Write-Host ""
  Write-Host "==================================================="
  Write-Host "Validation complete"
  Write-Host ""
  Write-Host "Review the generated files:"
  Write-Host "  .stronghold/latest-scan.json"
  Write-Host "  .stronghold/report.md"
  Write-Host "  .stronghold/drp.yaml"
  Write-Host "  .stronghold/runbook.yaml"
  Write-Host "  .stronghold/iam-policy.json"
  Write-Host ""
  Write-Host "Manually verify:"
  Write-Host "  - resource counts and service coverage"
  Write-Host "  - DR score realism and report findings"
  Write-Host "  - dependency mapping and recovery order"
  Write-Host "  - generated AWS CLI commands in the runbook"
  Write-Host "  - absence of crashes or unhandled errors"
  Write-Host "==================================================="
} finally {
  Pop-Location
}
