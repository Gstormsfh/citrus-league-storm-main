$ErrorActionPreference = "Continue"

$tasks = @(
  "CitrusLiveIngest",
  "CitrusLiveExtract",
  "CitrusSeasonRollupHourly"
)

foreach ($t in $tasks) {
  try {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false | Out-Null
    Write-Host ("[OK] Removed task: {0}" -f $t)
  } catch {
    Write-Host ("[SKIP] Task not found: {0}" -f $t)
  }
}


