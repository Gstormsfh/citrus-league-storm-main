param(
  [string]$ProjectRoot,
  [string]$PythonPath = "python"
)

$ErrorActionPreference = "Continue"

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$logDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$logFile = Join-Path $logDir "data_scraping_service.log"
$script = Join-Path $ProjectRoot "data_scraping_service.py"

Push-Location $ProjectRoot
try {
  & $PythonPath $script *>> $logFile
} finally {
  Pop-Location
}
