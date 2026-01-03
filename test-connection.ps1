# Script de test de connexion pour Stronghold
Write-Host "=== Test de connexion Stronghold ===" -ForegroundColor Cyan

# Test 1: Vérifier que le backend répond
Write-Host "`n1. Test du backend sur http://localhost:4000/health" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✓ Backend accessible - Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "  Réponse: $($response.Content.Substring(0, [Math]::Min(100, $response.Content.Length)))" -ForegroundColor Gray
} catch {
    Write-Host "✗ Backend non accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Vérifiez que le backend est démarré avec: docker-compose up backend" -ForegroundColor Yellow
}

# Test 2: Vérifier que le frontend répond
Write-Host "`n2. Test du frontend sur http://localhost:3000" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✓ Frontend accessible - Status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "✗ Frontend non accessible: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Vérifiez que le frontend est démarré avec: docker-compose up frontend" -ForegroundColor Yellow
}

# Test 3: Test avec API key
Write-Host "`n3. Test API avec clé dev-key sur http://localhost:4000/services" -ForegroundColor Yellow
try {
    $headers = @{
        "x-api-key" = "dev-key"
        "Content-Type" = "application/json"
    }
    $response = Invoke-WebRequest -Uri "http://localhost:4000/services" -Method GET -Headers $headers -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✓ API accessible avec clé - Status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "✗ API non accessible: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "  Status Code: $statusCode" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Fin des tests ===" -ForegroundColor Cyan

