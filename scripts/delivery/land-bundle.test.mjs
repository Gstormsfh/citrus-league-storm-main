// CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
// CATEGORY: ACTIVE
// Purpose:     Pin the safety contract of scripts/delivery/land-bundle.ps1
// Last active: 2026-09-01
// Invoked:     npm run test:scripts   (node --test "scripts/**/*.test.mjs")
// Reads:       scripts/delivery/land-bundle.ps1 (as text)
// Writes:      nothing
// ────────────────────────────────────────────────────────────
/**
 * PowerShell cannot run in the container (and CI is Linux), so the delivery
 * script is tested as TEXT: every rule below is one that, if broken, put a PR
 * on the wrong branch or stranded a paste mid-way on 2026-09-01.
 *
 *   - Windows PowerShell 5.1 only: no `&&`, `||`, `??`; native exit codes are
 *     checked through $LASTEXITCODE after EVERY git/gh call.
 *   - The bundle is verified before it is read.
 *   - The branch is fetched by refspec and pushed by refspec. Nothing is ever
 *     checked out: the founder's tree is dirty and master lives in a separate
 *     worktree.
 *   - master is refused as a landing branch.
 *   - Every gh pr call names --repo explicitly; create names --base and --head.
 *     gh inferring the checked-out branch is how PR #324 was hit by mistake.
 *   - Every mutating call is behind the -DryRun guard.
 *
 * The regexes are deliberately literal. If the script changes shape, change
 * the test in the same commit and say why in the message.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'land-bundle.ps1');

const raw = readFileSync(SCRIPT, 'utf8');

// Comment-based help and full-line comments are free to *mention* anything;
// the contract is about what executes.
function stripComments(source) {
  return source
    .replace(/<#[\s\S]*?#>/g, '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const code = stripComments(raw);
const codeLines = code.split('\n');

// A line that runs git or gh, optionally capturing its stdout.
const INVOCATION = /^\s*(?:\$\w+\s*=\s*)?(git|gh)\s+(.+)$/;

const invocations = codeLines
  .map((line, index) => {
    const m = INVOCATION.exec(line);
    return m ? { index, line: line.trim(), tool: m[1], args: m[2].trim() } : null;
  })
  .filter(Boolean);

function nextNonBlank(index) {
  for (let j = index + 1; j < codeLines.length; j += 1) {
    if (codeLines[j].trim() !== '') return codeLines[j];
  }
  return '';
}

function precedingLines(index, count) {
  const out = [];
  for (let j = index - 1; j >= 0 && out.length < count; j -= 1) {
    if (codeLines[j].trim() !== '') out.push(codeLines[j]);
  }
  return out;
}

const REFSPEC = String.raw`"\+?refs/heads/\$\{?Branch\}?:refs/heads/\$\{?Branch\}?"`;

test('is a Windows PowerShell 5.1 script with the documented parameters', () => {
  assert.match(raw, /^#Requires -Version 5\.1\s*$/m, 'must declare #Requires -Version 5.1');
  assert.match(code, /^\s*param\(/m, 'must start with a param() block');
  for (const p of ['[string]$Bundle', '[string]$Branch', '[string]$Title', '[string]$BodyFile']) {
    assert.ok(code.includes(p), `param block must declare ${p}`);
  }
  for (const s of ['[switch]$Merge', '[switch]$AutoMerge', '[switch]$DryRun']) {
    assert.ok(code.includes(s), `param block must declare ${s}`);
  }
  assert.match(code, /\$ErrorActionPreference\s*=\s*'Stop'/, 'cmdlet errors must be terminating');
});

test('uses no PowerShell 7 syntax (the paste that failed on PS 5.1 used &&)', () => {
  assert.doesNotMatch(code, /&&/, 'no && (PS 5.1 has no pipeline-chain operators)');
  assert.doesNotMatch(code, /\|\|/, 'no || (PS 5.1 has no pipeline-chain operators)');
  assert.doesNotMatch(code, /\?\?/, 'no ?? (null-coalescing is PS 7)');
});

test('never redirects native stderr (with $ErrorActionPreference=Stop, PS 5.1 turns it into a terminating error)', () => {
  assert.doesNotMatch(code, /\s2>/, 'no 2>&1, 2>$null or 2>file on native commands');
});

test('verifies the bundle before reading anything out of it', () => {
  const verify = invocations.findIndex((inv) => inv.tool === 'git' && inv.args.startsWith('bundle verify'));
  const fetch = invocations.findIndex((inv) => inv.tool === 'git' && inv.args.startsWith('fetch'));
  assert.notEqual(verify, -1, 'must run git bundle verify');
  assert.notEqual(fetch, -1, 'must run git fetch');
  assert.ok(verify < fetch, 'git bundle verify must run before git fetch');
});

test('fetches the branch out of the bundle by refspec and never checks anything out', () => {
  const fetchRe = new RegExp(String.raw`^\s*git fetch \$\w+ ${REFSPEC}\s*$`, 'm');
  assert.match(code, fetchRe, 'must fetch with git fetch <bundle> "+refs/heads/<branch>:refs/heads/<branch>"');

  // Whole file, comments included: the words must not even appear.
  assert.doesNotMatch(raw, /\bgit\s+(checkout|switch)\b/, 'no git checkout / git switch anywhere');
  assert.doesNotMatch(raw, /\bgit\s+-C\b[^\n]*\b(checkout|switch)\b/, 'no git -C <path> checkout / switch either');
  assert.doesNotMatch(code, /\b(Set-Location|Push-Location)\b/, 'must not change directory');
  assert.doesNotMatch(code, /^\s*cd\s/m, 'must not change directory');
  assert.doesNotMatch(code, /\bgit\s+(reset|stash|clean|merge|rebase|pull)\b/, 'no working-tree operations of any kind');
});

test('the refspec uses ${Branch}, not $Branch: (PowerShell reads "$Branch:refs" as a scoped variable)', () => {
  assert.doesNotMatch(code, /\$Branch:/, 'write ${Branch}: — "$Branch:" expands to nothing in PowerShell');
});

test('refuses to land master', () => {
  assert.match(code, /\$Branch -ieq 'master'/, "must compare -Branch against 'master' case-insensitively");
  assert.match(code, /\$Branch -ieq 'main'/, "must refuse 'main' too");
  assert.match(code, /\$Branch -ieq \$Base/, 'must refuse the base branch whatever it is');
  const line = codeLines.findIndex((l) => /\$Branch -ieq 'master'/.test(l));
  assert.match(nextNonBlank(line), /throw \(New-Failure 'refuse master'/, 'the refusal must throw a named failure');
});

test('refuses when the branch is checked out in any worktree', () => {
  assert.match(code, /^\s*\$\w+ = git worktree list --porcelain\s*$/m, 'must read git worktree list --porcelain');
  assert.match(code, /"branch refs\/heads\/\$Branch"/, 'must compare every worktree branch line against refs/heads/<branch>');
  assert.match(code, /throw \(New-Failure 'worktree check'/, 'must throw a named failure');
});

test('pushes by refspec with upstream tracking, never a bare git push', () => {
  const pushRe = new RegExp(String.raw`^\s*git push @?\S+ origin ${REFSPEC}\s*$`, 'm');
  assert.match(code, pushRe, 'must push with git push -u origin "refs/heads/<branch>:refs/heads/<branch>"');
  assert.match(code, /\$pushArgs = @\('-u'\)/, 'push must set upstream (-u)');
  assert.doesNotMatch(code, /git push\s*$/m, 'no bare git push');
  assert.doesNotMatch(code, /git push (?!@pushArgs)[^\n]*--force(?!-with-lease)/, 'plain --force is never used');
});

test('opens the PR with explicit --repo, --base and --head (nothing inferred from HEAD)', () => {
  const create = invocations.find((inv) => inv.tool === 'gh' && inv.args.startsWith('pr create'));
  assert.ok(create, 'must run gh pr create');
  for (const flag of ['--repo $Repo', '--base $Base', '--head $Branch', '--title $Title', '--body-file $bodyPath']) {
    assert.ok(create.args.includes(flag), `gh pr create must pass ${flag}`);
  }
  assert.match(code, /^\s*\$originUrl = git remote get-url origin\s*$/m, 'owner/repo must come from the origin remote');
  assert.match(code, /'github\\\.com\[:\/\]/, 'origin URL must be parsed into owner/repo');
});

test('every gh pr call names --repo explicitly', () => {
  const prCalls = invocations.filter((inv) => inv.tool === 'gh' && inv.args.startsWith('pr '));
  assert.ok(prCalls.length >= 6, `expected at least 6 gh pr calls, found ${prCalls.length}`);
  for (const inv of prCalls) {
    assert.ok(inv.args.includes('--repo $Repo'), `missing --repo $Repo: ${inv.line}`);
  }
});

test('reads the PR number with gh pr view and merges by number', () => {
  assert.match(code, /^\s*\$number = gh pr view \$Branch --repo \$Repo --json number -q \.number\s*$/m);
  assert.match(code, /^\s*gh pr checks \$number --repo \$Repo --watch\s*$/m, '-Merge must watch checks first');
  assert.match(code, /^\s*gh pr merge \$number --repo \$Repo --squash --delete-branch\b/m, '-Merge must squash-merge and delete the branch');
  assert.match(code, /^\s*gh pr merge \$number --repo \$Repo --auto --squash --delete-branch\b/m, '-AutoMerge must use --auto');
  assert.match(code, /^\s*\$url = gh pr view \$number --repo \$Repo --json url -q \.url\s*$/m, 'must print the PR URL at the end');
  assert.doesNotMatch(code, /gh pr merge[^\n]*--merge\b/, 'squash is the only merge method (CLAUDE.md)');
  assert.doesNotMatch(code, /gh pr merge[^\n]*--rebase\b/, 'squash is the only merge method (CLAUDE.md)');
  assert.match(code, /if \(\$Merge -and \$AutoMerge\)/, '-Merge and -AutoMerge must be mutually exclusive');
});

test('checks $LASTEXITCODE immediately after every git and gh call', () => {
  assert.ok(invocations.length >= 17, `expected at least 17 git/gh invocations, found ${invocations.length}`);
  const missing = invocations.filter((inv) => !/^\s*if \(\$LASTEXITCODE -ne 0\)/.test(nextNonBlank(inv.index)));
  assert.deepEqual(
    missing.map((inv) => inv.line),
    [],
    'these git/gh calls are not followed by an if ($LASTEXITCODE -ne 0) check',
  );
  const checks = codeLines.filter((l) => /^\s*if \(\$LASTEXITCODE -ne 0\)/.test(l)).length;
  assert.equal(checks, invocations.length, 'one $LASTEXITCODE check per git/gh call, no strays');
});

test('every mutating call sits behind the -DryRun guard', () => {
  const MUTATING = [/^fetch /, /^push /, /^pr create /, /^pr merge /, /^pr checks /, /^branch -D /];
  const mutating = invocations.filter((inv) => MUTATING.some((re) => re.test(inv.args)));
  assert.ok(mutating.length >= 6, `expected at least 6 mutating calls, found ${mutating.length}`);
  for (const inv of mutating) {
    const guarded = precedingLines(inv.index, 6).some((l) => /if \(-not \$DryRun\)/.test(l));
    assert.ok(guarded, `not behind if (-not $DryRun): ${inv.line}`);
  }
});

test('every failure names the step and says what to do', () => {
  assert.match(code, /function New-Failure\(\[string\]\$Step, \[string\]\$Hint\)/);
  assert.match(code, /"STEP FAILED: \$Step`nWHAT TO DO:  \$Hint"/);
  const throws = (code.match(/throw \(New-Failure '[^']+' /g) || []).length;
  assert.ok(throws >= 25, `expected at least 25 named failures, found ${throws}`);
  assert.doesNotMatch(code, /^\s*throw (?!\(New-Failure)/m, 'every throw must go through New-Failure');
  assert.match(code, /^\s*exit 1\s*$/m, 'failures must exit 1 so the founder can see it in $LASTEXITCODE');
});

test('validates the PR title with the same rule as conventions.yml', () => {
  const conventions = readFileSync(join(HERE, '..', '..', '.github', 'workflows', 'conventions.yml'), 'utf8');
  const ciRule = /grep -qE '(\^\(feat\|fix[^']*)'/.exec(conventions);
  assert.ok(ciRule, 'conventions.yml must still carry the title regex this test mirrors');
  assert.ok(code.includes(`$titleRegex = '${ciRule[1]}'`), 'the script must embed exactly the conventions.yml title regex');
  assert.match(code, /\$Title -cnotmatch \$titleRegex/, 'title match must be case-sensitive like grep -E');
});
