# Delivery — landing a bundle as a PR

> How code written in Claude's container reaches `master`. Audience: Garrett
> (today), anyone who lands bundles later. Script: `scripts/delivery/land-bundle.ps1`.
> Contract test: `scripts/delivery/land-bundle.test.mjs` (`npm run test:scripts`).

Claude's container cannot reach github.com. Code leaves it as a `git bundle`
written into the Windows clone; a person on a machine with GitHub credentials
turns that bundle into a pull request. Until 2026-09-01 that step was a
hand-pasted PowerShell block, re-typed every session, and it failed in three
ways in one evening: Windows PowerShell 5.1 rejected `&&`, `gh` inferred the
checked-out branch (`data/citrus-property-2026-08-26`, ~134 uncommitted demo
files) and targeted PR #324 instead of opening a new PR, and the block was run
in the wrong terminal. The script replaces the paste. This runbook says which
terminal, what the one line is, and what each failure message means.

---

## 1. The three-terminal rule

Three machines, three jobs. Nothing crosses the lines.

| Terminal | Use it for | Never use it for |
|---|---|---|
| **Windows PowerShell 5.1** in the clone (`C:\Users\garre\Documents\citrus-league-storm-main`) | Landing code: `land-bundle.ps1`, `git fetch` / `git push`, `gh pr ...`. This is the machine that holds the `gh` login and receives the bundles. | `gcloud`, engine builds, Xcode |
| **Browser Cloud Shell** | `gcloud`: draft-engine image builds and deploys (`gcloud builds submit`, `add-metadata`, `reset`, `gcloud logging read`) per [`../DEPLOY_PROTOCOL_F26_F27.md`](../DEPLOY_PROTOCOL_F26_F27.md). | Pushing branches or opening PRs — the bundle is not there and there is no `gh` login |
| **Mac** | `git pull && npm run ios:sync`, then Xcode → Run / Archive → Distribute → TestFlight, per [`../apple/IOS_BUILD.md`](../apple/IOS_BUILD.md). | Landing PRs, `gcloud` |

If a block Claude hands you contains `gcloud`, it is a Cloud Shell block. If it
contains `gh pr` or `land-bundle.ps1`, it is a PowerShell block. If it contains
`ios:sync` or Xcode, it is a Mac block.

---

## 2. The one line

Run from the clone root, in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\delivery\land-bundle.ps1 -Bundle .\x.bundle -Branch feat/x -Title "feat(x): ..." -BodyFile "$env:TEMP\pr-x.md"
```

Claude supplies the four values with every bundle: the bundle path, the branch
name it carries, the PR title, and a Markdown body file (What / Why / How, the
PR template). That line creates the PR and prints its URL. Variants:

| Add | Effect |
|---|---|
| `-Merge` | After the PR exists, `gh pr checks --watch` blocks until CI finishes, then squash-merges with `--delete-branch` and deletes the local branch. Use when you want to watch it land. |
| `-AutoMerge` | After the PR exists, enables GitHub auto-merge (squash) and exits immediately. GitHub merges when the required checks pass. Needs the one-time settings in §6; until those exist it fails with a message saying so. |
| `-DryRun` | Prints every command instead of running it. Local read-only lookups still run (repo root, origin URL, worktree list, bundle verification, `gh auth status`, existing-PR lookup) so the printed commands are exact. Nothing is fetched, pushed, created or merged. |
| `-ForceWithLease` | Push with `--force-with-lease`. Only for re-landing a rebased bundle on a branch that already exists on origin; the normal push is refused as non-fast-forward in that case and the message tells you to use this. |
| `-Base <branch>` | PR base. Default `master`. |
| `-Repo owner/repo` | Override the slug parsed from `git remote get-url origin`. |

Re-running the same line is always safe. Bundle verification, fetch and push
are idempotent, and an already-open PR for the branch is reused rather than
duplicated — so the answer to "it failed at step N" is: fix what the message
says, re-run the line.

The script exits 0 on success, 1 on any failure, and prints the PR URL as the
last line on success.

---

## 3. What the script does, in order

Nothing mutates before step 4, and every check that can be done without
touching origin or GitHub is done first.

| Step | Command | Why |
|---|---|---|
| 1 | argument checks | `-Branch master` (or `main`, or the base) is refused. The title is checked against the same Conventional Commits regex as `conventions.yml`, so a bad title is caught here instead of as a red check. Bundle and body file must exist. |
| 2 | `git rev-parse --show-toplevel`, `git check-ref-format --branch`, `git remote get-url origin`, `git worktree list --porcelain`, `gh auth status` | Locate the clone, validate the branch name, derive `owner/repo` from origin, refuse if the branch is checked out in **any** worktree, confirm `gh` is logged in. |
| 3 | `git bundle verify`, `git bundle list-heads` | The bundle is readable, its base commit exists locally, and it carries `refs/heads/<Branch>`. |
| 4 | `git fetch <bundle> "+refs/heads/<Branch>:refs/heads/<Branch>"` | Moves one ref. **No checkout.** Prints the old and new SHA of the local branch. |
| 5 | `git push -u origin "refs/heads/<Branch>:refs/heads/<Branch>"` | Pushes by refspec — the branch name is stated, never inferred. |
| 6 | `gh pr list --repo --head --base` then `gh pr create --repo <owner/repo> --base master --head <Branch> --title --body-file` | Reuses an open PR if one exists; otherwise creates one. Every flag `gh` could infer from the checked-out branch is passed explicitly. |
| 7 | `gh pr view <Branch> --repo --json number -q .number` | The PR number by head branch, never by "current branch". |
| 8 | `-Merge`: `gh pr checks <n> --watch`, `gh pr merge <n> --squash --delete-branch --subject "<Title> (#<n>)"`, `git branch -D <Branch>` · `-AutoMerge`: `gh pr merge <n> --auto --squash --delete-branch --subject ...` · neither: skipped | Squash is the only merge method; the PR title becomes the squash subject with GitHub's `(#n)` suffix. |
| 9 | `gh pr view <n> --repo --json url -q .url` | Prints the URL. |

Every `git` / `gh` call is followed by `if ($LASTEXITCODE -ne 0) { throw ... }`.
Windows PowerShell 5.1 has no `&&`, and `$ErrorActionPreference = 'Stop'` does
not see native exit codes, so this is the only way a failed push stops the
script before it opens a PR for a branch that is not on origin.

---

## 4. Why it never checks out

The founder's clone is not a clean tree and cannot be treated like one:

- The checked-out branch carries untracked demo files (~134 on
  `data/citrus-property-2026-08-26` on 2026-09-01). Any `git checkout` /
  `git switch` risks a "would be overwritten" refusal at best and stranded
  work at worst.
- `master` is checked out in a **separate worktree** (`C:/Users/garre/Documents/cprop`).
  Git refuses to check out a branch that another worktree holds, so a pasted
  `git checkout master` in the main clone fails — and a script that assumed it
  succeeded would then push from the wrong branch.
- `gh` infers `--head` from the current branch when it is not given. That is
  the whole PR #324 incident: the paste ran on the demo branch, `gh pr create`
  found that branch already had an open PR, and the work went there.

A refspec fetch (`+refs/heads/x:refs/heads/x` from the bundle) and a refspec
push (`refs/heads/x:refs/heads/x` to origin) move refs only. The index and
working tree are never read or written; the checked-out branch stays exactly
where it is. The worktree check in step 2 closes the one gap: a refspec fetch
*could* move a branch that some worktree currently has checked out, so the
script refuses to run in that case rather than pull the floor out from under a
working tree.

The contract test (`scripts/delivery/land-bundle.test.mjs`) fails the build if
`git checkout`, `git switch`, `Set-Location`, or any working-tree operation
appears in the script, or if any `gh pr` call loses its `--repo`.

---

## 5. Failure messages

Every failure prints two lines — `STEP FAILED: <step>` and `WHAT TO DO: ...` —
followed by "Nothing was checked out and your working tree was not touched."
The `WHAT TO DO` line is the fix; this table is the longer form.

| `STEP FAILED:` | Meaning | What to do |
|---|---|---|
| `arguments` | A required parameter is missing, or both `-Merge` and `-AutoMerge` were given. | Pass all four of `-Bundle -Branch -Title -BodyFile`; pick one merge mode. |
| `refuse master` | `-Branch` was `master`, `main`, or the base branch. | Ask Claude for the bundle on a `prefix/short-slug` branch. The script never pushes to the trunk. |
| `title check` | `-Title` is not Conventional Commits, or ends with a period. `conventions.yml` would reject the PR anyway. | `type(scope): lowercase description`, type in `feat fix refactor perf style test docs build ops chore`. |
| `find git` / `find gh` | Not on PATH in this window. | Install (`winget install --id GitHub.cli`), open a **new** window, `gh auth login`. |
| `find bundle` / `find body file` | The path does not exist relative to the current directory. | `cd` into the clone; check the file name Claude gave you. |
| `locate repo` | Not inside a git clone. Usually the wrong terminal (Cloud Shell or Mac) or the wrong directory. | Windows PowerShell, `cd C:\Users\garre\Documents\citrus-league-storm-main`. |
| `branch name` | `-Branch` is not a valid ref name (spaces, `..`, trailing slash). | Copy the name from `git bundle list-heads <bundle>`. |
| `read origin` | No `origin` remote, or its URL is not a GitHub URL. | `git remote add origin https://github.com/<owner>/<repo>.git`, or pass `-Repo owner/repo`. |
| `worktree check` | The branch is checked out in some worktree (path printed). The fetch would move a ref a working tree is standing on. | In that worktree: `git switch --detach` (or move to another branch), then re-run. Or ask Claude for the bundle on a new branch name. |
| `gh auth` | `gh` is not logged in. | `gh auth login` → GitHub.com → HTTPS → browser. |
| `bundle verify` | The bundle is corrupt, or its prerequisite commit (the `master` Claude built on) is not in this clone. | `git fetch origin`, re-run. Still failing → ask Claude for a fresh bundle. |
| `bundle heads` | The bundle does not contain `refs/heads/<Branch>`; the refs it does contain are printed. | Pass the printed branch name as `-Branch`. |
| `fetch` | Git could not update the local ref from the bundle. | Run the two commands the message names (`git bundle verify`, `git fetch origin`), re-run. |
| `push` | Origin rejected the push. `non-fast-forward` / `fetch first` means `origin/<Branch>` has commits the bundle lacks. | If the remote branch is your own earlier landing of the same work and this bundle is its rebased replacement: re-run with `-ForceWithLease`. Otherwise `git fetch origin <Branch>` and ask Claude to rebase onto it. Anything else (auth, network): fix, re-run. |
| `pr lookup` | `gh pr list` failed. Token cannot read the repo, or GitHub is down. | `gh auth status`; re-run. |
| `pr create` | The push succeeded (`origin/<Branch>` exists); only the PR is missing. | Fix what `gh` printed, re-run the same line — fetch and push are no-ops and it goes straight to creating the PR. |
| `pr number` | No open PR with head `<Branch>` on the repo, or `gh` returned something that is not a number. | Check `https://github.com/<owner>/<repo>/pulls`; re-run. If `gh` output is garbage, `winget upgrade GitHub.cli`. |
| `pr checks` (`-Merge`) | A check failed, or none were reported. | Open the PR's Checks tab, send the failing job to Claude. When the fix arrives as a new bundle on the same branch, re-run (with `-ForceWithLease` if it was rebased); the open PR is reused. |
| `pr merge` (`-Merge`) | GitHub refused the merge: a check still pending or red, branch behind base under a "require up to date" rule, or already merged. | Read the message; fix; re-run. "Behind base" → ask Claude to rebase and send a new bundle. |
| `auto-merge` (`-AutoMerge`) | Auto-merge is not available: no branch protection with required checks, or "Allow auto-merge" is off. | Do §6 once, or re-run with `-Merge` instead. |
| `pr url` | PR exists; URL lookup failed. The URL is printed in the message anyway. | Nothing — open the printed URL. |

A red PowerShell stack trace instead of `STEP FAILED:` means a *cmdlet* threw
(not git or gh) — most likely a path with characters PowerShell 5.1 cannot
handle. Copy the whole output to Claude.

---

## 6. One-time GitHub settings (Garrett, ~5 minutes) — required for `-AutoMerge`

`-Merge` works today. `-AutoMerge` — the mode where you run one line and walk
away — needs GitHub to know which checks gate a merge. Repo → Settings:

1. **Branches → Add branch protection rule** for `master`:
   - Require a pull request before merging. Do **not** require review from
     code owners — on a solo repo that blocks auto-merge outright
     (`CODEOWNERS` stays advisory until a second reviewer exists).
   - Require status checks to pass before merging. Required checks (these are
     the `name:` values of the jobs in `ci.yml` and `conventions.yml`; GitHub
     matches on that string, so renaming a job silently drops it from the
     rule):
     `Lint`, `Type Check (Server)`, `Build (Web)`, `Build (Server)`,
     `Test (Web)`, `Test (Server)`, `Validate Migrations`,
     `PR Title (Conventional Commits)`. `Type Check (Web)` (the baseline
     ratchet) and `Test (Scripts)` are also hard-fail jobs and can be required.
   - Leave "require branches to be up to date" **off** for now; with 50+ PRs a
     week it forces a rebase-and-re-land on every PR that lands behind another.
2. **General → Pull Requests**: enable **Allow auto-merge**; restrict merge
   methods to **squash** only; enable **Automatically delete head branches**
   (with `--auto` the merge happens later, so `gh`'s `--delete-branch` cannot
   do the deletion itself).

Until (1) and (2) exist, `-AutoMerge` fails at `STEP FAILED: auto-merge` with
this section's name in the message.

---

## 7. Claude's side (what arrives with the bundle)

So the four values are never guessed:

- The bundle is built as `git bundle create <slug>.bundle origin/master..<branch>`
  (prerequisite = the `master` tip the branch was cut from), written into the
  clone root, and named after the branch (`feat-x.bundle` for `feat/x`) so
  that `dir *.bundle` reads as a list of branches.
- The branch is `prefix/short-slug` (CLAUDE.md, Branching Strategy). Never
  `master`.
- The title is the PR title *and* the squash subject: Conventional Commits,
  lowercase description, no trailing period.
- The body file is the filled-in What / Why / How template, saved to
  `$env:TEMP\pr-<slug>.md` by the founder from the text Claude provides (or
  written by Claude into the clone alongside the bundle, in which case
  `-BodyFile .\pr-<slug>.md`).

Claude's message should end with the one line from §2, filled in, and nothing
else to paste.

---

## 8. After the merge

- `-Merge` deleted both the remote and local branch. Nothing to do.
- `-AutoMerge` or no merge flag: once merged, `git branch -D <branch>` and
  `git fetch --prune origin` in the clone whenever convenient. The script
  never deletes a branch it did not just merge.
- The `master` worktree (`cprop`) updates itself only when you tell it to:
  `git pull --ff-only` there. Production deploys do not depend on it —
  `production-deploy.yml` runs off the squash commit on GitHub.

---

## 9. The contract test

`scripts/delivery/land-bundle.test.mjs` reads the script **as text** (PowerShell
cannot run in the container or on the Linux CI runner) and pins the rules that
matter: `#Requires -Version 5.1`; no `&&` / `||` / `??`; no stderr redirection;
`git bundle verify` before `git fetch`; refspec fetch and refspec push, and no
`git checkout` / `git switch` / directory change anywhere in the file; `master`
refused; worktree scan present; `--repo` on every `gh pr` call and `--base` +
`--head` on `gh pr create`; `gh pr view <branch> --json number`; squash-only
merge; `$LASTEXITCODE` check on the line after **every** git / gh call (counted
both ways); every mutating call behind the `-DryRun` guard; every throw through
the `STEP FAILED / WHAT TO DO` formatter; the title regex byte-identical to
`conventions.yml`'s.

Run it with `npm run test:scripts` (root; `node --test`, no dependencies). CI
runs it as the `Test (Scripts)` job in `ci.yml`. If the script's shape changes,
change the test in the same commit and say why.
