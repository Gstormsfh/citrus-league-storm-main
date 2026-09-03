/**
 * ENV_VARS BLOCK GUARD (2026-09-03).
 *
 * `env_vars: |` in a workflow is a YAML LITERAL BLOCK SCALAR. Inside one,
 * `#` starts nothing — every line is data, comments included. The Cloud Run
 * deploy action splits that data on newlines and takes each line as
 * `NAME=VALUE`, so a comment becomes an environment variable whose NAME is
 * the comment text.
 *
 * WHAT THIS ACTUALLY DID
 *
 * Commit b3e7497b (chunk 11g.9) wrote six explanatory lines inside the block:
 *
 *     env_vars: |
 *       SUPABASE_SERVICE_ROLE_KEY=${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
 *       # Chunk 11g.9: Stormy moved off the Edge Function, so the
 *       # Anthropic key has to reach the API server. It must be set
 *       # HERE rather than by `gcloud run services update` — this
 *       # env_vars block REPLACES the service's environment on every
 *       # deploy, so a manually-set var is wiped by the next push
 *       # (same failure shape as the scaling flags below).
 *       ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
 *
 * Production `citrus-api` has carried environment variables named
 * `# deploy` and `so a manually-set var is wiped by the next push` ever
 * since. Confirmed on the live service 2026-09-03.
 *
 * THE PART WORTH REMEMBERING
 *
 * The comment that became a variable is the one asserting that this block
 * "REPLACES the service's environment on every deploy." Had that been true,
 * the junk would have been erased by the very next push. It was not — it
 * survived every deploy for over a week, including the one that set
 * DRAFT_WS_HOST. So `env_vars` MERGES, and the claim refuted itself by
 * outliving the mechanism it described. (`flags:` genuinely does reset each
 * deploy — that was the April 10 disaster — and the comment conflated the
 * two.) Nothing reads a variable called `# deploy`, so the cost was
 * confusion rather than an outage, but it cost hours of one.
 *
 * WHY A TEST
 *
 * `yaml.safe_load` parses the file happily; it is valid YAML, and the
 * comments are valid *content*. No linter objects, because nothing is
 * malformed. The mistake is only visible by knowing what `|` means, and it
 * is invisible again the moment the file scrolls. The block is also the one
 * place in the repo where writing a comment is actively harmful, which is
 * exactly the kind of local rule a reviewer cannot be expected to hold.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(HERE, '../../..');
const WORKFLOWS = resolve(REPO, '.github/workflows');

/** Keys whose value is a literal block scalar consumed as `NAME=VALUE` lines. */
const LINE_ORIENTED_BLOCKS = ['env_vars', 'secrets', 'labels'] as const;

interface Offender {
  file: string;
  line: number;
  text: string;
  key: string;
}

/**
 * Lines inside a `<key>: |` block that would be read as data but were
 * written as comments.
 *
 * Indentation is the whole game: a block scalar owns every following line
 * indented MORE than its key, and ends at the first line indented the same
 * or less. Blank lines belong to the block and are skipped rather than
 * ending it, which is why they cannot be used as a terminator here.
 */
function commentsInsideBlocks(src: string, file: string): Offender[] {
  const out: Offender[] = [];
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)([A-Za-z_][\w-]*):\s*[|>][-+]?\s*$/);
    if (!open) continue;

    const key = open[2];
    if (!LINE_ORIENTED_BLOCKS.includes(key as (typeof LINE_ORIENTED_BLOCKS)[number])) continue;

    const keyIndent = open[1].length;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^\s*$/.test(line)) continue;
      const indent = line.search(/\S/);
      if (indent <= keyIndent) break;
      if (/^\s*#/.test(line)) {
        out.push({ file, line: j + 1, text: line.trim(), key });
      }
    }
  }
  return out;
}

function workflowFiles(): string[] {
  if (!existsSync(WORKFLOWS)) return [];
  return readdirSync(WORKFLOWS)
    .filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
    .map((n) => join(WORKFLOWS, n));
}

const FILES = workflowFiles();

describe('no comments inside line-oriented block scalars', () => {
  it('there are workflows to check', () => {
    // A path typo would make every assertion below vacuously pass.
    expect(FILES.length).toBeGreaterThan(0);
  });

  it('every workflow is clean', () => {
    const found = FILES.flatMap((p) =>
      commentsInsideBlocks(readFileSync(p, 'utf8'), p.replace(`${REPO}/`, '')),
    );

    expect(
      found,
      'A "#" line inside a `env_vars: |` block is NOT a comment. YAML literal ' +
        'block scalars have no comment syntax, so the deploy action reads the ' +
        'line as data and creates an environment variable whose NAME is the ' +
        'comment text. Production has carried variables named "# deploy" since ' +
        '2026-08. Put the explanation ABOVE the key, at the key\'s own ' +
        'indentation, where YAML treats it as a real comment. Found: ' +
        found.map((f) => `${f.file}:${f.line} (${f.key}) ${f.text}`).join('; '),
    ).toEqual([]);
  });
});

describe('the guard bites', () => {
  // Pinning the detector, not the repo's current state. A scan only ever
  // exercised by files that already pass it proves nothing.
  const scan = (src: string) => commentsInsideBlocks(src, 'test.yml');

  it('catches the exact block that polluted production', () => {
    const src = [
      '        with:',
      '          env_vars: |',
      '            NODE_ENV=production',
      '            # Chunk 11g.9: Stormy moved off the Edge Function, so the',
      '            # Anthropic key has to reach the API server. It must be set',
      '            ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}',
    ].join('\n');
    expect(scan(src)).toHaveLength(2);
  });

  it('allows a comment ABOVE the key, which is a real comment', () => {
    const src = [
      '        with:',
      '          # This one YAML does treat as a comment.',
      '          env_vars: |',
      '            NODE_ENV=production',
      '            DRAFT_WS_HOST=draft.citrusfantasysports.com',
    ].join('\n');
    expect(scan(src)).toEqual([]);
  });

  it('ends the block at a line indented back to the key', () => {
    // The real file's scaling comment sits at the key's own indentation and
    // is therefore outside the block. Flagging it would be a false positive
    // on correct code, which is how a guard gets deleted.
    const src = [
      '          env_vars: |',
      '            NODE_ENV=production',
      '          # ── Cloud Run scaling config ──',
      '          flags: >-',
      '            --memory=2Gi',
    ].join('\n');
    expect(scan(src)).toEqual([]);
  });

  it('does not end the block on a blank line', () => {
    // Blank lines belong to a block scalar. Treating one as a terminator
    // would let a comment after it through.
    const src = [
      '          env_vars: |',
      '            NODE_ENV=production',
      '',
      '            # still inside the block',
      '            OTHER=1',
    ].join('\n');
    expect(scan(src)).toHaveLength(1);
  });

  it('ignores a value that merely CONTAINS a hash', () => {
    // `#` is only special at the start of a line here. A hash inside a value
    // is ordinary data and must not trip the scan.
    const src = ['          env_vars: |', '            COLOR=#ff9900'].join('\n');
    expect(scan(src)).toEqual([]);
  });

  it('ignores blocks that are not line-oriented', () => {
    // `run: |` is a shell script. `#` there is a genuine shell comment and
    // forbidding it would be absurd.
    const src = [
      '          run: |',
      '            # this is a real shell comment',
      '            echo ok',
    ].join('\n');
    expect(scan(src)).toEqual([]);
  });
});
