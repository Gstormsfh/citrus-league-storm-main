param(
  [string]$ProjectRoot,
  [string]$PythonPath = "python"
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Ensure-Dir($p) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

$opsDir = Join-Path $ProjectRoot "ops\windows"
$logDir = Join-Path $ProjectRoot "logs"
Ensure-Dir $logDir

$serviceScript = Join-Path $ProjectRoot "data_scraping_service.py"

Write-Host "Installing Data Scraping Service scheduled task from $opsDir"
Write-Host "Project Root: $ProjectRoot"
Write-Host "Python Path: $PythonPath"
Write-Host "Service Script: $serviceScript"
Write-Host ""

# Verify script exists
if (-not (Test-Path $serviceScript)) {
  Write-Host "ERROR: Service script not found at $serviceScript" -ForegroundColor Red
  exit 1
}

function New-TaskActionPwsh($scriptPath) {
  # Use Windows PowerShell (5.1) compatibility
  return New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectRoot `"$ProjectRoot`" -PythonPath `"$PythonPath`""
}

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

function Install-Task($name, $action, $trigger) {
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
  Register-ScheduledTask -TaskName $name -InputObject $task -Force | Out-Null
  Write-Host "Installed $name" -ForegroundColor Green
}

# Create wrapper script for the service
$wrapperScript = Join-Path $opsDir "run_data_scraping_service.ps1"
$wrapperContent = @"
param(
  [string]`$ProjectRoot,
  [string]`$PythonPath = "python"
)

`$ErrorActionPreference = "Continue"

if (-not `$ProjectRoot) {
  `$ProjectRoot = (Resolve-Path (Join-Path `$PSScriptRoot "..\..")).Path
}

`$logDir = Join-Path `$ProjectRoot "logs"
if (-not (Test-Path `$logDir)) { New-Item -ItemType Directory -Path `$logDir | Out-Null }

`$logFile = Join-Path `$logDir "data_scraping_service.log"
`$script = Join-Path `$ProjectRoot "data_scraping_service.py"

Push-Location `$ProjectRoot
try {
  & `$PythonPath `$script *>> `$logFile
} finally {
  Pop-Location
}
"@

Set-Content -Path $wrapperScript -Value $wrapperContent -Encoding UTF8
Write-Host "Created wrapper script: $wrapperScript" -ForegroundColor Green

# Startup trigger (run at boot)
$startupTrigger = New-ScheduledTaskTrigger -AtStartup

Install-Task "CitrusDataScrapingService" (New-TaskActionPwsh $wrapperScript) $startupTrigger

Write-Host ""
Write-Host "Data Scraping Service installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "The service will:"
Write-Host "  - Start automatically at system boot"
Write-Host "  - Run daily PBP processing at 11:59 PM"
Write-Host "  - Run adaptive live ingestion (30s during games, 5min off-hours)"
Write-Host "  - Run live stats updates during game nights (every 30s)"
Write-Host "  - Run daily projections at 6:00 AM"
Write-Host ""
Write-Host "Logs will be written to: $logDir\data_scraping_service.log"
Write-Host ""
Write-Host "To uninstall, run: .\ops\windows\uninstall_data_scraping_service.ps1"
Write-Host ""


