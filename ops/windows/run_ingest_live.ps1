param(
  [string]$ProjectRoot,
  [string]$PythonPath = "python"
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$logDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$logFile = Join-Path $logDir "ingest_live.log"
$script = Join-Path $ProjectRoot "ingest_live_raw_nhl.py"

Push-Location $ProjectRoot
try {
  & $PythonPath $script *>> $logFile
} finally {
  Pop-Location
}


