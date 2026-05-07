// Phase 4.5 chunk 11g.7 sub-step 7a — engine code MUST use the new
// `structuredLogger` from `@citrus/shared`. Raw `console.*` calls and
// the legacy `logger` from `@citrus/shared/utils/logger` are NOT
// permitted in:
//
//   - server/src/draft/
//   - server/src/services/DraftServiceV2.ts
//   - server/src/lib/draftToken.ts
//
// This vitest source-scan test enforces the boundary in CI without
// adding ESLint as a new server dependency. Failures emit a clear
// remediation message pointing at the offending file + line.
//
// Architectural rationale (Decision Log 2026-05-07): the legacy
// `logger` is a free-text variadic emitter retained for non-engine
// code that hasn't migrated. Engine code goes through
// `structuredLogger` for GCP Cloud Logging compatibility.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SERVER_SRC = resolve(__dirname, '..');

/** Recursively walk a directory; return absolute paths to every `.ts` file. */
function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip __tests__ subdirectories — test files are allowed to use
      // console.* (vitest-internal) and may import the legacy logger
      // for non-engine assertions.
      if (entry === '__tests__') continue;
      walkTsFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Files / directories where engine-code rules apply. Anything in
 * these paths (excluding __tests__ subdirs handled by walkTsFiles)
 * must use `structuredLogger` and is BANNED from `console.*` and
 * the legacy `logger`.
 */
const ENGINE_PATHS = [
  resolve(SERVER_SRC, 'draft'),
  resolve(SERVER_SRC, 'services/DraftServiceV2.ts'),
  resolve(SERVER_SRC, 'lib/draftToken.ts'),
];

function collectEngineFiles(): string[] {
  const out: string[] = [];
  for (const p of ENGINE_PATHS) {
    const stat = statSync(p);
    if (stat.isDirectory()) {
      walkTsFiles(p, out);
    } else if (stat.isFile() && p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

function scanFile(file: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Strip line comments to avoid false positives on commented-out
    // code / explanatory comments that mention `console.log` or
    // `logger.info`.
    const codePart = line.replace(/\/\/.*$/, '');

    // Pattern 1: raw console.* call sites (log/warn/error/debug/info).
    // Match the actual call (followed by `(`).
    if (/\bconsole\.(log|warn|error|debug|info)\s*\(/.test(codePart)) {
      violations.push({
        file,
        line: i + 1,
        text: line.trim(),
        pattern: 'raw console.* call',
      });
    }

    // Pattern 2: legacy `logger.<severity>(` emit call. The legacy
    // logger may still be IMPORTED for activation purposes (e.g.,
    // `Object.assign(logger, createConsoleLogger())` in the entry
    // point), but engine code MUST NOT emit through it — use
    // `structuredLogger.<severity>(...)` instead.
    //
    // The match anchors on `logger.` followed by a severity method
    // and `(`. Negative lookbehind avoids matching `structuredLogger.`
    // (which is a substring of `XXXstructuredLogger.info(...)`).
    const legacyEmitMatch = /(?<![A-Za-z_])logger\.(log|warn|error|debug|info)\s*\(/.exec(
      codePart,
    );
    if (legacyEmitMatch) {
      violations.push({
        file,
        line: i + 1,
        text: line.trim(),
        pattern: 'legacy logger.* call',
      });
    }
  }
  return violations;
}

describe('Engine code logging boundary (chunk 11g.7 sub-step 7a)', () => {
  it('engine code uses structuredLogger only — no raw console.* and no legacy logger imports', () => {
    const files = collectEngineFiles();
    expect(files.length).toBeGreaterThan(0); // sanity: did we find files?

    const allViolations: Violation[] = [];
    for (const file of files) {
      allViolations.push(...scanFile(file));
    }

    if (allViolations.length > 0) {
      const summary = allViolations
        .map(
          (v) =>
            `  ${v.file.replace(SERVER_SRC, 'server/src')}:${v.line} (${v.pattern})\n    ${v.text}`,
        )
        .join('\n');
      throw new Error(
        `Engine code must use structuredLogger; raw console and legacy logger are not permitted in server/src/draft/, server/src/services/DraftServiceV2.ts, or server/src/lib/draftToken.ts.\n\nViolations:\n${summary}`,
      );
    }
  });
});
