/**
 * DRAFT ROOM MOBILE PASS (2026-09-01) — the founder ran a live mock
 * draft on an iPhone 17 Pro simulator and filed a laundry list:
 * "this page looks horrendous on iphone 17 pro." Broken down, five
 * concrete failures, each pinned here so a future edit cannot quietly
 * reintroduce it:
 *
 * 1. TWO CLOCKS THAT DISAGREED. The sticky-header timer floored
 *    (00:19) while the on-clock bar ceiled (0:20) — a permanent
 *    one-second disagreement between two countdowns on the same
 *    screen, in different formats on top of it. Both now ceil (the
 *    countdown convention: a fresh 30s clock reads 30, and 0 renders
 *    only once the deadline truly passed) and both render mm:ss.
 *
 * 2. THE EXIT SCROLLED AWAY AND WAS GREY. "Add draft room to pages I
 *    can't back out of" — filed AFTER the exit link shipped, because
 *    text-muted-foreground above the header was invisible in practice.
 *    The exit now lives inside the sticky header (never scrolls away)
 *    in brand orange.
 *
 * 3. STORMY'S FAB SAT ON THE PLAYER LIST. A fixed 56px circle at the
 *    bottom-left of the one screen where every pixel is the pick UI
 *    and every misclick has a shot clock. Hidden on draft routes.
 *
 * 4. "C. Mc…" — an abbreviation of an abbreviation. shortName() plus
 *    a crowded name row truncated even the abbreviated form. The pool
 *    renders full names everywhere now; position/team moved to the
 *    stat line.
 *
 * 5. NO WRITE-UPS IN THE DRAFT PLAYER CARD. "We need these all baked
 *    in" — the deterministic Player Outlook the roster modal has
 *    carried since 2026-08-25 now renders in PlayerCardDialog too.
 *
 * jsdom has no layout engine — these are source contracts, same
 * pattern as draftRoomExitGuard / leagueHqCompositionGuard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

const TIMER = read('../components/draft/v2/DraftTimerV2.tsx');
const BAR = read('../components/draft/v2/OnClockActionBar.tsx');
const ROOM = read('../pages/DraftRoomV2.tsx');
const STORMY = read('../components/StormyChatBubble.tsx');
const POOL = read('../components/draft/PlayerPool.tsx');
const CARD = read('../components/draft/PlayerCardDialog.tsx');

describe('the two draft countdowns render one clock', () => {
  it('DraftTimerV2 ceils the remaining seconds (never floors)', () => {
    expect(TIMER).toMatch(/Math\.max\(0, Math\.ceil\(raw \/ 1000\)\)/);
    expect(TIMER).not.toMatch(/Math\.floor\(raw \/ 1000\)/);
  });

  it('OnClockActionBar ceils too — same rounding, same second', () => {
    expect(BAR).toMatch(/Math\.ceil\(\(deadlineMs \+ clockOffsetMs - nowMs\) \/ 1000\)/);
  });

  it('both format as mm:ss with padded minutes', () => {
    // Header timer label:
    expect(TIMER).toMatch(/String\(minutes\)\.padStart\(2, '0'\)/);
    // Bar countdown — minutes padded (was `${m}:` unpadded → "0:20"
    // against the header's "00:19"):
    expect(BAR).toMatch(/String\(m\)\.padStart\(2, '0'\)/);
    expect(BAR).toContain("return '00:00'");
  });
});

describe('the exit is part of the sticky header, not above it', () => {
  it('StickyHeader owns the draft-room-exit link', () => {
    const headerFn = ROOM.slice(ROOM.indexOf('function StickyHeader'));
    const headerBody = headerFn.slice(0, headerFn.indexOf('\n// ──'));
    expect(headerBody).toContain('data-testid="draft-room-exit"');
  });

  it('the exit is brand orange in both rooms — never muted grey', () => {
    const exits = ROOM.split('data-testid="draft-room-exit"');
    // First chunk is pre-exit source; each later chunk starts inside a
    // Link whose className follows within a few lines.
    expect(exits.length, 'both rooms keep their exit').toBeGreaterThanOrEqual(3);
    for (const chunk of exits.slice(1)) {
      const classNameLine = chunk.slice(0, chunk.indexOf('League HQ'));
      expect(classNameLine).toContain('text-pastel-orange');
      expect(classNameLine).not.toContain('text-muted-foreground');
    }
  });
});

describe('nothing floats over the player pool during a draft', () => {
  it('StormyChatBubble stands down on every draft route', () => {
    expect(STORMY).toMatch(/\/\^\\\/\(draft\|draft-v2\|draft-room\)\(\\\/\|\$\)\/\.test\(location\.pathname\)/);
  });

  it('the on-clock bar owns the bottom edge on phones instead of fighting the header', () => {
    expect(ROOM).toMatch(/fixed inset-x-3 bottom-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\] z-40 lg:sticky/);
    expect(ROOM).not.toMatch(/"sticky top-24 z-20"/);
    // …and the room container leaves clearance so the list's last rows
    // scroll out from under it.
    expect(ROOM).toMatch(/pb-28 lg:pb-4/);
  });
});

describe('players keep their names', () => {
  it('the pool renders full_name — the shortName abbreviator is gone', () => {
    expect(POOL).not.toContain('shortName');
    expect(POOL).toContain('{player.full_name}');
  });

  it('no 140px name box — the sticky column affords the real name', () => {
    expect(POOL).not.toContain('max-w-[140px]');
  });
});

describe('the draft player card carries the write-up', () => {
  it('PlayerCardDialog renders the deterministic Player Outlook', () => {
    expect(CARD).toContain("import { generatePlayerWriteup");
    expect(CARD).toContain('data-testid="player-card-writeup"');
    expect(CARD).toContain('Player Outlook');
    // Headline + summary + analysis + tags — the full block, not a stub.
    for (const field of ['writeup.headline', 'writeup.summary', 'writeup.analysis', 'writeup.tags']) {
      expect(CARD).toContain(field);
    }
  });

  it('the dialog scrolls on phones instead of clipping the Draft button', () => {
    expect(CARD).toContain('max-h-[85vh] overflow-y-auto');
  });
});
