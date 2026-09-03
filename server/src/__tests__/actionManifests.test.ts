/**
 * COMPOSITE ACTION MANIFEST GUARD (2026-09-03).
 *
 * A composite action manifest is parsed by a DIFFERENT expression evaluator
 * than a workflow, and it knows a much smaller set of contexts. `job` and
 * `secrets` are not among them. Name either one anywhere GitHub templates a
 * value, and the manifest does not merely misbehave, it FAILS TO LOAD:
 *
 *     TemplateValidationException: The template is not valid.
 *     action.yml (Line: 12, Col: 18): Unrecognized named-value: 'job'.
 *     action.yml (Line: 30, Col: 18): Unrecognized named-value: 'secrets'.
 *
 * Every job that used the action died on that, four at once, including both
 * production deploy jobs.
 *
 * WHAT MAKES THIS WORTH A TEST RATHER THAN A CODE REVIEW
 *
 * The offending expressions were in `description:` fields. They were
 * DOCUMENTATION, telling a caller to pass `${{ secrets.VITE_SUPABASE_URL }}`
 * — advice that is correct, for the workflow, where the caller writes it. The
 * `runs:` block was right the whole time and used `inputs.*` throughout.
 *
 * So this is not a case of someone using the wrong context. It is a case of
 * an expression appearing where nobody expected one to be EVALUATED. Reading
 * the file, the descriptions look inert. They are not: GitHub templates the
 * whole manifest, prose included.
 *
 * Nothing else here could catch it. `yaml.safe_load` parses the file happily,
 * because it is valid YAML. Only the runner rejects it, and only when a job
 * tries to use it, which on this repo means after a merge to master.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(HERE, '../../..');
const ACTIONS_DIR = resolve(REPO, '.github/actions');

/**
 * Contexts a workflow may name that a composite action manifest may not.
 * `inputs`, `github`, `env`, `runner`, `steps` and `strategy` are all fine
 * inside an action, which is why the list is a denylist rather than the
 * reverse: the allowed set differs by field, the forbidden set does not.
 */
const FORBIDDEN_CONTEXTS = ['job', 'secrets', 'needs', 'vars'] as const;

function actionManifests(): string[] {
  if (!existsSync(ACTIONS_DIR)) return [];
  return readdirSync(ACTIONS_DIR)
    .map((name) => join(ACTIONS_DIR, name))
    .filter((p) => statSync(p).isDirectory())
    .flatMap((dir) => ['action.yml', 'action.yaml'].map((f) => join(dir, f)))
    .filter((p) => existsSync(p));
}

/**
 * Every `${{ ... }}` in the file with the line it sits on.
 *
 * YAML comments are stripped first. GitHub never sees them, so an expression
 * quoted in a comment is genuinely inert, and flagging it would push the next
 * author into writing riddles instead of documentation.
 */
function expressions(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  src.split('\n').forEach((raw, i) => {
    if (/^\s*#/.test(raw)) return;
    for (const m of raw.matchAll(/\$\{\{([^}]*)\}\}/g)) {
      out.push({ line: i + 1, text: m[1].trim() });
    }
  });
  return out;
}

const MANIFESTS = actionManifests();

describe('composite action manifests only name contexts they can resolve', () => {
  it('there are manifests to check', () => {
    // A path typo here would make every assertion below vacuously pass.
    expect(MANIFESTS.length).toBeGreaterThan(0);
  });

  for (const path of MANIFESTS) {
    const rel = path.replace(`${REPO}/`, '');

    it(`${rel} names no workflow-only context`, () => {
      const found = expressions(readFileSync(path, 'utf8')).filter((e) =>
        FORBIDDEN_CONTEXTS.some((c) => new RegExp(`\\b${c}\\.`).test(e.text)),
      );

      expect(
        found,
        `${rel} references a context a composite action cannot resolve. The runner ` +
          `rejects the whole manifest with "Unrecognized named-value", so EVERY job ` +
          `using this action fails before it runs a step. If the expression is ` +
          `documentation telling a caller what to pass, write the name without ` +
          `${'${{'} ${'}}'} around it. Found: ` +
          found.map((f) => `line ${f.line}: ${f.text}`).join('; '),
      ).toEqual([]);
    });
  }
});

describe('the guard bites', () => {
  // Pinning the detector, not the repo's current state. A scan that cannot
  // fail proves nothing, and this one is only ever exercised by files that
  // already pass it.
  const scan = (src: string) =>
    expressions(src).filter((e) =>
      FORBIDDEN_CONTEXTS.some((c) => new RegExp(`\\b${c}\\.`).test(e.text)),
    );

  it('catches the exact three lines that broke production', () => {
    const src = [
      'inputs:',
      '  status:',
      '    description: Normally `${{ job.status }}`.',
      '  supabase-url:',
      '    description: Pass `${{ secrets.VITE_SUPABASE_URL }}`.',
      '  key:',
      '    description: Pass `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}`.',
    ].join('\n');
    expect(scan(src)).toHaveLength(3);
  });

  it('allows the contexts a composite action really can use', () => {
    const src = [
      'runs:',
      '  using: composite',
      '  steps:',
      '    - shell: bash',
      '      env:',
      '        A: ${{ inputs.status }}',
      '        B: ${{ github.token }}',
      '        C: ${{ runner.os }}',
      '      run: echo ok',
    ].join('\n');
    expect(scan(src)).toEqual([]);
  });

  it('ignores an expression quoted inside a YAML comment', () => {
    // GitHub never sees comments. Flagging them would force the next author
    // to document this rule without being able to name the thing it forbids.
    expect(scan('    # do not write ${{ job.status }} in a description')).toEqual([]);
  });

  it('reads an expression on an otherwise commented-looking line', () => {
    // A trailing comment does not exempt the value before it.
    expect(scan('    value: ${{ secrets.FOO }} # inline note')).toHaveLength(1);
  });
});
