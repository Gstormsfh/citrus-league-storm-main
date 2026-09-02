#Requires -Version 5.1
<#
.SYNOPSIS
  Land a git bundle as a pull request into master from Windows PowerShell 5.1,
  without ever touching the working tree.

.DESCRIPTION
  Claude's container cannot reach github.com, so code arrives in the Windows
  clone as a `git bundle`. This script is the one sanctioned path from that
  bundle to a PR:

    verify bundle -> fetch the branch by refspec (no checkout) -> push by refspec
      -> gh pr create --repo/--base/--head (explicit, never inferred)
      -> optionally watch checks and squash-merge, or enable auto-merge

  Why it is shaped the way it is (docs/RUNBOOKS/DELIVERY.md has the long form):

  * It never checks anything out. The founder's tree carries untracked demo
    files and `master` lives in a separate worktree. On 2026-09-01 a hand-pasted
    block let `gh` infer the checked-out branch (data/citrus-property-2026-08-26)
    and it targeted PR #324 instead of opening a new one. Every gh call here
    names --repo, --base and --head explicitly, so nothing is inferred from HEAD.
  * Windows PowerShell 5.1 has no pipeline-chain operators and
    $ErrorActionPreference does not see native exit codes, so every git/gh call
    is followed by an explicit $LASTEXITCODE check that names the step and says
    what to do next.
  * Re-running the same line after fixing a problem is always safe: bundle
    verify, fetch and push are idempotent, and an already-open PR for the branch
    is reused rather than duplicated.

.PARAMETER Bundle
  Path to the .bundle file Claude wrote (relative paths are resolved from the
  current directory).

.PARAMETER Branch
  Branch name carried by the bundle (refs/heads/<Branch>) and the PR head.
  Never master.

.PARAMETER Title
  PR title. Must follow Conventional Commits (same rule as
  .github/workflows/conventions.yml) because it becomes the squash commit subject.

.PARAMETER BodyFile
  Markdown file holding the PR body (What / Why / How).

.PARAMETER Base
  PR base branch. Default: master.

.PARAMETER Repo
  owner/repo override. Default: parsed from `git remote get-url origin`.

.PARAMETER Merge
  After the PR exists, run `gh pr checks --watch` and squash-merge when green.
  Blocks this terminal until CI finishes.

.PARAMETER AutoMerge
  After the PR exists, enable GitHub auto-merge (squash) and exit. Requires
  branch protection with required checks and "Allow auto-merge" on the repo.

.PARAMETER ForceWithLease
  Push with --force-with-lease. Only for re-landing a rebased bundle on a branch
  that already exists on origin (the push is otherwise refused as
  non-fast-forward). Never applies to master: the script refuses master before
  it gets here.

.PARAMETER DryRun
  Print every command instead of running it. Local, read-only lookups (repo root,
  origin URL, worktree list, bundle verification, gh auth status, existing PR
  lookup) still run so the printed commands are accurate.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\delivery\land-bundle.ps1 -Bundle .\x.bundle -Branch feat/x -Title "feat(x): ..." -BodyFile "$env:TEMP\pr-x.md"

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\delivery\land-bundle.ps1 -Bundle .\x.bundle -Branch feat/x -Title "feat(x): ..." -BodyFile "$env:TEMP\pr-x.md" -Merge

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\delivery\land-bundle.ps1 -Bundle .\x.bundle -Branch feat/x -Title "feat(x): ..." -BodyFile "$env:TEMP\pr-x.md" -DryRun
#>
param(
  [string]$Bundle,
  [string]$Branch,
  [string]$Title,
  [string]$BodyFile,
  [string]$Base = 'master',
  [string]$Repo = '',
  [switch]$Merge,
  [switch]$AutoMerge,
  [switch]$ForceWithLease,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

# Echo the command about to run. Mutating commands are printed but not run under
# -DryRun; read-only commands run either way (they are what make the dry-run
# output accurate).
function Show-Cmd([string]$Text, [bool]$Mutates = $false) {
  if ($Mutates -and $DryRun) {
    Write-Host "    [dry-run] would run: $Text" -ForegroundColor Yellow
  } else {
    Write-Host "    > $Text" -ForegroundColor DarkGray
  }
}

# Quote an argument for display only. Native calls below pass variables directly;
# PowerShell quotes them for the child process on its own.
function Format-Arg([string]$Value) {
  if ($Value -match '[\s"]') { return '"' + ($Value -replace '"', '\"') + '"' }
  return $Value
}

# Every failure is "which step" + "what to do". The catch block at the bottom
# prints this and exits 1, so a red PowerShell stack trace never hides it.
function New-Failure([string]$Step, [string]$Hint) {
  return "STEP FAILED: $Step`nWHAT TO DO:  $Hint"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$url = ''

try {
  # -- 1. Arguments --------------------------------------------------------
  Write-Step '[1/9] Check arguments'

  if (-not $Bundle) {
    throw (New-Failure 'arguments' 'Pass -Bundle <path to the .bundle Claude wrote>, e.g. -Bundle .\feat-x.bundle')
  }
  if (-not $Branch) {
    throw (New-Failure 'arguments' 'Pass -Branch <branch name inside the bundle>, e.g. -Branch feat/x. Run "git bundle list-heads <bundle>" to see what the bundle carries.')
  }
  if (-not $Title) {
    throw (New-Failure 'arguments' 'Pass -Title "<type>(<scope>): <lowercase description>" -- it becomes the squash commit subject.')
  }
  if (-not $BodyFile) {
    throw (New-Failure 'arguments' 'Pass -BodyFile <markdown file with the PR body>, e.g. -BodyFile "$env:TEMP\pr-x.md"')
  }
  if ($Merge -and $AutoMerge) {
    throw (New-Failure 'arguments' 'Pass either -Merge (watch checks in this terminal, then squash-merge) or -AutoMerge (GitHub merges when checks pass), not both.')
  }

  if ($Branch -like 'refs/heads/*') { $Branch = $Branch.Substring('refs/heads/'.Length) }

  # Refuse the trunk outright. Nothing lands on master except a squash merge of
  # a reviewed PR (CLAUDE.md, Git Workflow).
  if ($Branch -ieq 'master' -or $Branch -ieq 'main' -or $Branch -ieq $Base) {
    throw (New-Failure 'refuse master' "-Branch '$Branch' is the trunk. This script only lands feature branches as PRs into $Base; it never pushes to $Base. Ask Claude for a bundle on a prefix/short-slug branch (feat/, fix/, ops/, ...).")
  }

  # Same rule conventions.yml enforces on the PR title, checked here so a typo
  # does not cost a CI round trip. Case-sensitive on purpose (grep -E is).
  $titleRegex = '^(feat|fix|refactor|perf|style|test|docs|build|ops|chore)(\([a-z0-9._-]+\))?!?: [a-z0-9]'
  if ($Title -cnotmatch $titleRegex) {
    throw (New-Failure 'title check' "-Title '$Title' is not Conventional Commits. Use <type>(<scope>): <lowercase description> with type in feat|fix|refactor|perf|style|test|docs|build|ops|chore, e.g. -Title `"feat(draft): add pick timer`".")
  }
  if ($Title -match '\.$') {
    throw (New-Failure 'title check' "-Title must not end with a period (conventions.yml rejects it).")
  }

  foreach ($tool in @('git', 'gh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
      if ($tool -eq 'gh') {
        throw (New-Failure 'find gh' 'GitHub CLI is not on PATH. Install it (winget install --id GitHub.cli), open a NEW PowerShell window, run "gh auth login", then re-run this line.')
      }
      throw (New-Failure 'find git' 'git is not on PATH. Install Git for Windows, open a NEW PowerShell window, then re-run this line.')
    }
  }

  if (-not (Test-Path -LiteralPath $Bundle -PathType Leaf)) {
    throw (New-Failure 'find bundle' "No file at '$Bundle' (relative to $(Get-Location)). Claude writes bundles into the clone root; check the file name, or cd into the clone first.")
  }
  # Git for Windows takes forward slashes everywhere; backslashes are not safe in
  # a refspec-style argument.
  $bundlePath = (Resolve-Path -LiteralPath $Bundle).Path -replace '\\', '/'

  if (-not (Test-Path -LiteralPath $BodyFile -PathType Leaf)) {
    throw (New-Failure 'find body file' "No file at '$BodyFile'. Save the PR body Claude gave you there (What / Why / How), or point -BodyFile at where you saved it.")
  }
  $bodyPath = (Resolve-Path -LiteralPath $BodyFile).Path

  # -- 2. Repository -------------------------------------------------------
  Write-Step '[2/9] Locate the repository (no checkout, ever)'

  Show-Cmd 'git rev-parse --show-toplevel'
  $repoRoot = git rev-parse --show-toplevel
  if ($LASTEXITCODE -ne 0) {
    throw (New-Failure 'locate repo' 'This directory is not inside a git clone. cd into the Windows clone of the repo (this is the PowerShell terminal, not Cloud Shell and not the Mac), then re-run this line.')
  }

  Show-Cmd "git check-ref-format --branch $(Format-Arg $Branch)"
  $null = git check-ref-format --branch $Branch
  if ($LASTEXITCODE -ne 0) {
    throw (New-Failure 'branch name' "-Branch '$Branch' is not a valid git branch name. Use prefix/short-slug (lowercase, hyphens), exactly as it appears in `"git bundle list-heads $bundlePath`".")
  }

  if (-not $Repo) {
    Show-Cmd 'git remote get-url origin'
    $originUrl = git remote get-url origin
    if ($LASTEXITCODE -ne 0) {
      throw (New-Failure 'read origin' 'This clone has no "origin" remote. Add it (git remote add origin https://github.com/<owner>/<repo>.git) or pass -Repo owner/repo.')
    }
    if ("$originUrl" -match 'github\.com[:/]([^/\s]+)/([^/\s]+?)(?:\.git)?/?$') {
      $Repo = "$($Matches[1])/$($Matches[2])"
    } else {
      throw (New-Failure 'read origin' "Could not read owner/repo from origin URL '$originUrl'. Pass -Repo owner/repo explicitly.")
    }
  }

  # Refuse if the branch is checked out in ANY worktree. The refspec fetch below
  # would move a ref that a working tree is sitting on, which is exactly the
  # kind of surprise this script exists to prevent.
  Show-Cmd 'git worktree list --porcelain'
  $worktreeLines = git worktree list --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw (New-Failure 'worktree check' 'git worktree list failed; the clone may be damaged. Run "git worktree prune" and "git status", then re-run this line.')
  }
  $currentWorktree = ''
  foreach ($line in @($worktreeLines)) {
    if ("$line" -like 'worktree *') { $currentWorktree = "$line".Substring('worktree '.Length) }
    elseif ("$line" -ieq "branch refs/heads/$Branch") {
      throw (New-Failure 'worktree check' "Branch '$Branch' is checked out in worktree '$currentWorktree'. This script never moves a branch that a working tree is on. In that worktree, detach HEAD or move to a different branch (see docs/RUNBOOKS/DELIVERY.md), then re-run this line.")
    }
  }

  Show-Cmd 'gh auth status --hostname github.com'
  gh auth status --hostname github.com
  if ($LASTEXITCODE -ne 0) {
    throw (New-Failure 'gh auth' 'GitHub CLI is not logged in. Run "gh auth login" (GitHub.com, HTTPS, login with a web browser), then re-run this line.')
  }

  $mode = 'create the PR and stop'
  if ($Merge) { $mode = 'create the PR, watch checks, squash-merge when green' }
  if ($AutoMerge) { $mode = 'create the PR, enable auto-merge (squash), stop' }
  if ($DryRun) { $mode = "$mode   [DRY RUN: nothing is fetched, pushed, created or merged]" }

  Write-Host ''
  Write-Host "    Repo:    $repoRoot  (origin: $Repo)"
  Write-Host "    Bundle:  $bundlePath"
  Write-Host "    Branch:  $Branch  ->  origin/$Branch  ->  PR into $Base"
  Write-Host "    Title:   $Title"
  Write-Host "    Body:    $bodyPath"
  Write-Host "    Mode:    $mode"
  Write-Host '    Note:    your working tree is not touched; nothing is checked out.'

  # -- 3. Bundle -----------------------------------------------------------
  Write-Step '[3/9] Verify the bundle'

  Show-Cmd "git bundle verify $(Format-Arg $bundlePath)"
  git bundle verify $bundlePath
  if ($LASTEXITCODE -ne 0) {
    throw (New-Failure 'bundle verify' 'The bundle is unreadable, or the commit it was built on is missing from this clone. Run "git fetch origin" (the bundle sits on top of the master Claude saw), then re-run this line. If it still fails, ask Claude for a fresh bundle.')
  }

  Show-Cmd "git bundle list-heads $(Format-Arg $bundlePath)"
  $heads = git bundle list-heads $bundlePath
  if ($LASTEXITCODE -ne 0) {
    throw (New-Failure 'bundle heads' 'Could not list the refs inside the bundle. Ask Claude for a fresh bundle.')
  }
  $wantedRef = "refs/heads/$Branch"
  $foundRef = $false
  foreach ($h in @($heads)) {
    if ("$h" -match "\s$([regex]::Escape($wantedRef))$") { $foundRef = $true }
  }
  if (-not $foundRef) {
    throw (New-Failure 'bundle heads' "The bundle does not carry $wantedRef. It carries:`n$(@($heads) -join "`n")`nPass the branch name from that list as -Branch.")
  }

  # -- 4. Fetch by refspec (never checkout) --------------------------------
  Write-Step '[4/9] Fetch the branch out of the bundle (refspec, no checkout)'

  # `${Branch}` not `$Branch`: in PowerShell a `$name:` directly followed by
  # letters is a scoped-variable reference, so "refs/heads/$Branch:refs/..."
  # silently expands to nothing. Braces delimit the name.
  $refspec = "+refs/heads/${Branch}:refs/heads/${Branch}"

  Show-Cmd "git rev-parse --verify --quiet refs/heads/$Branch"
  $before = git rev-parse --verify --quiet "refs/heads/$Branch"
  if ($LASTEXITCODE -ne 0) { $before = '' }

  Show-Cmd "git fetch $(Format-Arg $bundlePath) $(Format-Arg $refspec)" $true
  if (-not $DryRun) {
    git fetch $bundlePath "+refs/heads/${Branch}:refs/heads/${Branch}"
    if ($LASTEXITCODE -ne 0) {
      throw (New-Failure 'fetch' "git could not update refs/heads/$Branch from the bundle. Run `"git bundle verify $bundlePath`" and `"git fetch origin`", then re-run this line. If the branch is checked out somewhere, see the worktree step above.")
    }

    Show-Cmd "git rev-parse --verify --quiet refs/heads/$Branch"
    $after = git rev-parse --verify --quiet "refs/heads/$Branch"
    if ($LASTEXITCODE -ne 0) {
      throw (New-Failure 'fetch' "refs/heads/$Branch does not exist after the fetch. Ask Claude for a fresh bundle that carries refs/heads/$Branch.")
    }
    if ($before) {
      Write-Host "    local $Branch moved: $before -> $after"
    } else {
      Write-Host "    local $Branch created at $after"
    }
  }

  # -- 5. Push by refspec --------------------------------------------------
  Write-Step "[5/9] Push refs/heads/$Branch to origin"

  $pushArgs = @('-u')
  if ($ForceWithLease) { $pushArgs += '--force-with-lease' }
  Show-Cmd "git push $($pushArgs -join ' ') origin $(Format-Arg "refs/heads/${Branch}:refs/heads/${Branch}")" $true
  if (-not $DryRun) {
    git push @pushArgs origin "refs/heads/${Branch}:refs/heads/${Branch}"
    if ($LASTEXITCODE -ne 0) {
      throw (New-Failure 'push' "origin rejected the push. 'non-fast-forward' or 'fetch first' means origin/$Branch has commits this bundle does not: if that remote branch is your own earlier landing of this same work and the bundle is a rebased replacement, re-run this line with -ForceWithLease; otherwise run `"git fetch origin $Branch`" and ask Claude to rebase onto it. Any other message (auth, network): fix it and re-run this line.")
    }
  }

  # -- 6. Pull request (explicit --repo/--base/--head, nothing inferred) ---
  Write-Step "[6/9] Open the PR $Branch -> $Base on $Repo"

  Show-Cmd "gh pr list --repo $Repo --head $Branch --base $Base --state open --json number --jq .[].number"
  $existingList = gh pr list --repo $Repo --head $Branch --base $Base --state open --json number --jq '.[].number'
  if ($LASTEXITCODE -ne 0) {
    throw (New-Failure 'pr lookup' "gh could not list PRs on $Repo. Check `"gh auth status`" and that the token can read $Repo, then re-run this line.")
  }
  $existing = ''
  $existingList = @($existingList) | Where-Object { "$_".Trim() -ne '' }
  if (@($existingList).Count -gt 0) { $existing = "$(@($existingList)[0])".Trim() }

  if ($existing) {
    Write-Host "    Open PR #$existing already exists for $Branch -> $Base; reusing it (no duplicate PR)."
  } else {
    Show-Cmd "gh pr create --repo $Repo --base $Base --head $Branch --title $(Format-Arg $Title) --body-file $(Format-Arg $bodyPath)" $true
    if (-not $DryRun) {
      gh pr create --repo $Repo --base $Base --head $Branch --title $Title --body-file $bodyPath
      if ($LASTEXITCODE -ne 0) {
        throw (New-Failure 'pr create' "The push succeeded (origin/$Branch exists); only the PR is missing. Fix what gh printed (auth, title, body file) and re-run the same line: fetch and push are no-ops and it goes straight to creating the PR.")
      }
    }
  }

  # -- 7. PR number --------------------------------------------------------
  Write-Step '[7/9] Read the PR number'

  $number = ''
  Show-Cmd "gh pr view $Branch --repo $Repo --json number -q .number"
  if ($DryRun -and -not $existing) {
    $number = '<pr-number>'
  } else {
    $number = gh pr view $Branch --repo $Repo --json number -q .number
    if ($LASTEXITCODE -ne 0) {
      throw (New-Failure 'pr number' "gh cannot find an open PR whose head is $Branch on $Repo. Open https://github.com/$Repo/pulls and look for $Branch; if the PR is there, re-run this line, otherwise re-run without -Merge/-AutoMerge to create it.")
    }
    $number = "$number".Trim()
    if ($number -notmatch '^\d+$') {
      throw (New-Failure 'pr number' "gh returned '$number' instead of a PR number. Re-run this line; if it repeats, upgrade gh (winget upgrade GitHub.cli).")
    }
    Write-Host "    PR #$number"
  }

  # -- 8. Merge ------------------------------------------------------------
  if ($Merge) {
    Write-Step "[8/9] Watch checks on PR #$number, then squash-merge"

    Show-Cmd "gh pr checks $number --repo $Repo --watch"
    if (-not $DryRun) {
      # Actions needs a moment to register runs on a brand-new PR; without the
      # pause --watch can see "no checks" and give up.
      Start-Sleep -Seconds 15
      gh pr checks $number --repo $Repo --watch
      if ($LASTEXITCODE -ne 0) {
        throw (New-Failure 'pr checks' "A check failed or none were reported for PR #$number. Open https://github.com/$Repo/pull/$number/checks to read the failing job and send it to Claude. When the fix lands as a new bundle on the same branch, re-run this line (with -ForceWithLease if the branch was rebased); the open PR is reused.")
      }
    }

    Show-Cmd "gh pr merge $number --repo $Repo --squash --delete-branch --subject $(Format-Arg "$Title (#$number)")" $true
    if (-not $DryRun) {
      gh pr merge $number --repo $Repo --squash --delete-branch --subject "$Title (#$number)"
      if ($LASTEXITCODE -ne 0) {
        throw (New-Failure 'pr merge' "GitHub refused the merge of PR #$number. Usual causes: a required check is still pending or red, the branch is behind $Base and protection requires it up to date (ask Claude to rebase and send a new bundle), or the PR was already merged. Read the message, fix it, re-run this line.")
      }
    }

    # Remote branch is gone with --delete-branch; drop the local ref too
    # (CLAUDE.md: delete branches after merge, local and remote). Not a checkout:
    # the worktree check above proved nothing is sitting on this branch.
    Show-Cmd "git branch -D $Branch" $true
    if (-not $DryRun) {
      git branch -D $Branch
      if ($LASTEXITCODE -ne 0) {
        Write-Warning "PR #$number is merged, but the local branch $Branch could not be deleted. Delete it later with: git branch -D $Branch"
      }
    }
  } elseif ($AutoMerge) {
    Write-Step "[8/9] Enable auto-merge (squash) on PR #$number"

    Show-Cmd "gh pr merge $number --repo $Repo --auto --squash --delete-branch --subject $(Format-Arg "$Title (#$number)")" $true
    if (-not $DryRun) {
      gh pr merge $number --repo $Repo --auto --squash --delete-branch --subject "$Title (#$number)"
      if ($LASTEXITCODE -ne 0) {
        throw (New-Failure 'auto-merge' "GitHub refused auto-merge on PR #$number. Auto-merge needs branch protection on $Base with required status checks AND 'Allow auto-merge' enabled in the repo settings (docs/RUNBOOKS/DELIVERY.md lists the exact settings). Until then, re-run this line with -Merge instead of -AutoMerge to watch the checks here.")
      }
    }
    Write-Host "    Auto-merge is on: GitHub will squash-merge PR #$number when the required checks pass. Nothing more to do here."
  } else {
    Write-Step '[8/9] Merge: skipped (no -Merge / -AutoMerge)'
    Write-Host "    Re-run this line with -Merge to watch checks and squash-merge, or merge from the PR page."
  }

  # -- 9. URL --------------------------------------------------------------
  Write-Step '[9/9] PR URL'

  Show-Cmd "gh pr view $number --repo $Repo --json url -q .url"
  if ($DryRun -and -not $existing) {
    $url = "https://github.com/$Repo/pull/$number"
  } else {
    $url = gh pr view $number --repo $Repo --json url -q .url
    if ($LASTEXITCODE -ne 0) {
      throw (New-Failure 'pr url' "PR #$number exists but gh could not read its URL. It is https://github.com/$Repo/pull/$number")
    }
    $url = "$url".Trim()
  }

  Write-Host ''
  Write-Host "PR: $url" -ForegroundColor Green
  if ($DryRun) { Write-Host 'DRY RUN complete: nothing was fetched, pushed, created or merged.' -ForegroundColor Yellow }
}
catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ''
  Write-Host 'Nothing was checked out and your working tree was not touched. Re-run the same line once the step above is fixed.' -ForegroundColor Red
  exit 1
}

exit 0
