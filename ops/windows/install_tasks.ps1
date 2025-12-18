param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$PythonPath = "python"
)

$ErrorActionPreference = "Stop"

function Ensure-Dir($p) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

$opsDir = Join-Path $ProjectRoot "ops\windows"
$logDir = Join-Path $ProjectRoot "logs"
Ensure-Dir $logDir

$ingestScript = Join-Path $opsDir "run_ingest_live.ps1"
$extractScript = Join-Path $opsDir "run_extractor_live.ps1"
$rollupScript = Join-Path $opsDir "run_season_rollup.ps1"

Write-Host "Installing scheduled tasks from $opsDir"

function New-TaskActionPwsh($scriptPath) {
  # Use Windows PowerShell (5.1) compatibility
  return New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectRoot `"$ProjectRoot`" -PythonPath `"$PythonPath`""
}

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

function Install-Task($name, $action, $trigger) {
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
  Register-ScheduledTask -TaskName $name -InputObject $task -Force | Out-Null
  Write-Host "Installed $name"
}

# Startup triggers (run at boot)
$startupTrigger = New-ScheduledTaskTrigger -AtStartup

Install-Task "CitrusLiveIngest" (New-TaskActionPwsh $ingestScript) $startupTrigger
Install-Task "CitrusLiveExtract" (New-TaskActionPwsh $extractScript) $startupTrigger

# Hourly rollup
$hourlyTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
Install-Task "CitrusSeasonRollupHourly" (New-TaskActionPwsh $rollupScript) $hourlyTrigger

Write-Host "Done."


