# ==============================================================================
# F1 Telemetry & Dashboard — Windows PowerShell Setup Launcher
# Usage: .\setup.ps1
# ==============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Check if Python is available
if (Get-Command python -ErrorAction SilentlyContinue) {
    & python setup.py $args
    exit $LASTEXITCODE
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py setup.py $args
    exit $LASTEXITCODE
}

Write-Host "Python non détecté. Vérification de Docker..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    Write-Host "Création du fichier .env..." -ForegroundColor Cyan
    Copy-Item ".env.example" ".env"
    Write-Host "Fichier .env initialisé depuis .env.example." -ForegroundColor Green
}

Write-Host "Démarrage de la stack Docker Compose..." -ForegroundColor Green
docker compose up --build -d

Write-Host ""
Write-Host "🏁 Dashboard disponible sur : http://localhost" -ForegroundColor Cyan
