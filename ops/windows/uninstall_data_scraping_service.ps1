$ErrorActionPreference = "Continue"

$taskName = "CitrusDataScrapingService"

try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false | Out-Null
    Write-Host "[OK] Removed scheduled task: $taskName" -ForegroundColor Green
  } else {
    Write-Host "[SKIP] Task not found: $taskName" -ForegroundColor Yellow
  }
} catch {
  Write-Host "[ERROR] Failed to remove task: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "Data Scraping Service uninstalled." -ForegroundColor Green
Write-Host ""


