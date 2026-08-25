# Citrus Toronto Game Day -- build and check, on Windows.
#
# Written for Windows PowerShell 5.1, which is what ships with Windows and
# which does NOT understand `&&`. That is why this is a file and not a
# one-liner: chaining a dozen commands with && only ever worked on my end.
#
#   powershell -ExecutionPolicy Bypass -File checks.ps1
#   powershell -ExecutionPolicy Bypass -File checks.ps1 -BuildOnly
#   powershell -ExecutionPolicy Bypass -File checks.ps1 -Rebake
#   powershell -ExecutionPolicy Bypass -File checks.ps1 -Recarve
#
# By default this joins index.html + app.js and runs the checks, which is
# what you want after editing either. The art is already inlined in app.js
# and does not need touching:
#
#   -Rebake    a file in art/ changed
#   -Recarve   a NEW Carlton render landed, so cut his seven layers again.
#              carve.py is the only script here that needs anything beyond
#              a bare Python:  pip install numpy scipy pillow

param(
  [switch]$BuildOnly,
  [switch]$Rebake,
  [switch]$Recarve
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Say($msg, $colour) { Write-Host $msg -ForegroundColor $colour }
function Rule { Write-Host ('-' * 62) -ForegroundColor DarkGray }

Say "`nCitrus -- Toronto Game Day" Cyan
Write-Host "  $PSScriptRoot"
Rule

# ---- is anything even here -------------------------------------------
$python = $null
foreach ($c in @('python', 'py', 'python3')) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { $python = $c; break }
}
if (-not $python) { Say "No python on PATH. Install it and run this again." Red; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Say "No node on PATH. Install it and run this again." Red; exit 1
}
Say ("python: " + (& $python --version 2>&1) + "   node: " + (& node --version)) DarkGray

# ---- build ------------------------------------------------------------
Rule
if ($Recarve) {
  Say "carve.py     cutting Carlton into seven layers" Yellow
  & $python carve.py
  if ($LASTEXITCODE -ne 0) {
    Say "  carve.py failed. It is the only script that needs more than a" Red
    Say "  bare Python:  $python -m pip install numpy scipy pillow" Red
    exit 1
  }
}
if ($Rebake -or $Recarve) {
  Say "bake_art.py  inlining the art" Yellow
  & $python bake_art.py
  if ($LASTEXITCODE -ne 0) {
    Say "  bake_art.py failed. If it refused rather than crashed, read what" Red
    Say "  it printed: it will not silently drop art that is already inlined," Red
    Say "  and it looks for the mascots under apps/web/public/mascots." Red
    exit 1
  }
}

Say "build.py     joining index.html + app.js" Yellow
& $python build.py
if ($LASTEXITCODE -ne 0) { Say "build.py failed" Red; exit 1 }

if ($BuildOnly) { Rule; Say "Built. Skipping the checks." Green; exit 0 }

# ---- the checks need playwright ---------------------------------------
Rule
# Join-Path twice, not one path with a separator in it: Windows PowerShell
# 5.1's Join-Path takes exactly two arguments and this has to run on 5.1.
$pwRoot = Join-Path (Join-Path $PSScriptRoot 'node_modules') 'playwright'
$pwHere = $false
if (Test-Path $pwRoot) { $pwHere = $true }
else {
  # It may already resolve from a parent folder. Ask the way the harnesses
  # ask -- a dynamic import -- and NOT require.resolve, which happily finds
  # a global install that ESM then refuses to load. That mismatch is how
  # this check passed while every suite failed to start.
  & node -e "import('playwright').then(function(){process.exit(0)},function(){process.exit(1)})" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $pwHere = $true }
}
if (-not $pwHere) {
  Say "playwright is not installed here. Fetching it (this takes a minute)." Yellow
  & npm install --no-package-lock playwright
  if ($LASTEXITCODE -ne 0) { Say "npm install failed" Red; exit 1 }
  Say "downloading a Chromium for it (about 150 MB, once)" Yellow
  & npx playwright install chromium
  if ($LASTEXITCODE -ne 0) {
    Say "  Could not fetch the browser. Everything above this line worked --" Red
    Say "  the page is built and opens fine; it is only the checks that need" Red
    Say "  a headless Chromium. Usually a proxy or a firewall. Retry with:" Red
    Say "    npx playwright install chromium" Red
    exit 1
  }
}

# ---- run them ---------------------------------------------------------
# Ordered loosely by how long each takes, so a quick failure fails quickly.
$suites = @(
  @{ f = 'offline.mjs';    what = 'no external requests, ever' },
  @{ f = 'classcheck.mjs'; what = 'class-name collisions' },
  @{ f = 'figcheck.mjs';   what = 'every piece owns its region, and a keyboard can reach it' },
  @{ f = 'rowcheck.mjs';   what = 'the rows point at a piece and open nothing' },
  @{ f = 'vecfall.mjs';    what = 'the vector fallback is the same control' },
  @{ f = 'leak.mjs';       what = 'no result language before the buzzer' },
  @{ f = 'mobsweep.mjs';   what = 'no sideways overflow at 390px' },
  @{ f = 'rank4.mjs';      what = "Rank 'Em, every category, every stage" },
  @{ f = 'audit_hub.mjs';  what = 'contrast on every panel' },
  @{ f = 'proof.mjs';      what = 'overflow and clipped text, 13 panels x 2 widths' },
  @{ f = 'mobplay.mjs';    what = 'every game played on a phone by real taps' },
  @{ f = 'realsite.mjs';   what = '5 device profiles, end to end' },
  @{ f = 'verify.mjs';     what = 'all ten games, end to end' }
)

# A carriage return over the "running" line only tidies up on a real
# console. Piped to a file it leaves both halves on the page, so the
# progress line is skipped when the output is going somewhere else.
$live = -not [Console]::IsOutputRedirected

$failed = @()
function Run($file, $what) {
  if (-not (Test-Path $file)) { Say ("  skip   " + $file + " (not here)") DarkGray; return }
  if ($live) { Write-Host ("  ...    " + $file.PadRight(16) + $what) -NoNewline }
  $out  = & node $file 2>&1
  $code = $LASTEXITCODE
  if ($live) { Write-Host "`r" -NoNewline }
  if ($code -eq 0) {
    Say ("  ok     " + $file.PadRight(16) + $what) Green
  } else {
    Say ("  FAIL   " + $file.PadRight(16) + $what) Red
    $script:failed += $file
    $out | Select-Object -Last 25 | ForEach-Object { Write-Host ("         " + $_) -ForegroundColor DarkRed }
  }
}

foreach ($s in $suites) { Run $s.f $s.what }

# audit_hub is run twice: the second skin has its own palette
$env:SKIN = 'bc'
Run 'audit_hub.mjs' 'contrast again, second skin'
Remove-Item Env:\SKIN -ErrorAction SilentlyContinue

Rule
if ($failed.Count -eq 0) {
  Say "All green. Double-click this with the wifi off and it still works:" Green
  # beside these sources in a working copy, one level up in the repo
  $built = Join-Path $PSScriptRoot 'Toronto_GameDay_Citrus.html'
  if (-not (Test-Path $built)) {
    $built = Join-Path (Split-Path $PSScriptRoot -Parent) 'Toronto_GameDay_Citrus.html'
  }
  Write-Host ("  " + $built)
  exit 0
} else {
  Say ("" + $failed.Count + " failed: " + ($failed -join ', ')) Red
  exit 1
}
