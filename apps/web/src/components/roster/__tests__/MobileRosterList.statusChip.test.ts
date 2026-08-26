// MOBILE ROSTER ROW — GAME STATUS CHIP (2026-08-26).
//
// Measured in Chromium at 393x852 against the real component: a bench row for
// a goalie whose game had finished rendered its status chip as "FINAL 4-" on
// one line and "2" on the next, doubling that row's height and breaking the
// list's rhythm against every other row.
//
// The chip lives in `flex items-center gap-1 ... overflow-hidden`, a row where
// every other child already carries flex-shrink-0. Being the only shrinkable
// item, it absorbed the entire squeeze — flex shrank its box below its
// content width and the text wrapped inside it. A status chip is atomic: it
// is shown whole or the row truncates something lower-priority (the stat
// line, which already carries `truncate`).
//
// jsdom has no layout engine and cannot reproduce a flex shrink, so this is a
// source contract rather than a rendered assertion — the same approach the
// sibling position-ring and status-colour locks in this directory take.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = readFileSync(resolve(HERE, '..', 'MobileRosterList.tsx'), 'utf8');

describe('MobileRosterList — the game status chip is atomic', () => {
  const badge = SRC.match(/const GameStatusBadge[\s\S]*?\n};/);

  it('GameStatusBadge is present', () => {
    expect(badge, 'GameStatusBadge not found in MobileRosterList.tsx').toBeTruthy();
  });

  it.each([
    ['final', /Final\{score/],
    ['live/intermission', /'intermission' \? 'INT' : 'LIVE'/],
  ])('the %s chip refuses to wrap or shrink', (_label, marker) => {
    const block = badge![0];
    expect(block).toMatch(marker);
    // Every <span> the badge can return must carry both guards. Without
    // whitespace-nowrap the text wraps; without flex-shrink-0 the box is the
    // one the parent row shrinks first.
    const spans = block.match(/<span className="[^"]*"/g) || [];
    expect(spans.length).toBeGreaterThanOrEqual(2);
    for (const span of spans) {
      expect(span, `chip span missing wrap guard: ${span}`).toContain('whitespace-nowrap');
      expect(span, `chip span missing shrink guard: ${span}`).toContain('flex-shrink-0');
    }
  });
});
