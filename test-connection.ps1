# Script de test de connexion pour Stronghold
Write-Host "=== Test de connexion Stronghold ===" -ForegroundColor Cyan

$apiKey = $env:SEED_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Host "SEED_API_KEY n'est pas defini. Definissez-le avant d'executer ce script." -ForegroundColor Red
    exit 1
}

# Test 1: Verifier que le backend repond
Write-Host "`n1. Test du backend sur http://localhost:4000/health/live" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/health/live" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "Backend accessible - Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "  Reponse: $($response.Content.Substring(0, [Math]::Min(100, $response.Content.Length)))" -ForegroundColor Gray
} catch {
    Write-Host "Backend non accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Verifiez que le backend est demarre avec: docker-compose up backend" -ForegroundColor Yellow
}

# Test 2: Verifier que le frontend repond
Write-Host "`n2. Test du frontend sur http://localhost:3000" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "Frontend accessible - Status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Frontend non accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Verifiez que le frontend est demarre avec: docker-compose up frontend" -ForegroundColor Yellow
}

# Test 3: Test avec API key
Write-Host "`n3. Test API avec la cle SEED_API_KEY sur http://localhost:4000/services" -ForegroundColor Yellow
try {
    $headers = @{
        "x-api-key" = $apiKey
        "Content-Type" = "application/json"
    }
    $response = Invoke-WebRequest -Uri "http://localhost:4000/services" -Method GET -Headers $headers -TimeoutSec 5 -ErrorAction Stop
    Write-Host "API accessible avec cle - Status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "API non accessible: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "  Status Code: $statusCode" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Fin des tests ===" -ForegroundColor Cyan
