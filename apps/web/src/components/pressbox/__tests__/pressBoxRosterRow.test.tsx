/**
 * PRESS BOX ROSTER ROW GUARD (2026-09-04).
 *
 * The row is the densest thing in the app and the spec's numbers for it are
 * exact -- grid, height, rungs, and which of three colours a points figure
 * wears. This pins the ones a later edit would flatten without failing
 * anything else, and the two absences that are POLICY rather than oversight.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PressBoxRosterRow, type PressBoxRosterRowPlayer } from '../RosterRow';
import { PressBoxRosterList, type PressBoxRosterSlotRow } from '../RosterList';
import { PB_ROW_HEADLINE, PB_ROW_META, PB_ROW_MICRO, PB_ROW_NAME } from '../rowScale';
import { PB_POSITION_CHIP_BASE } from '../positionChip';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const ROW_SRC = readFileSync(resolve(HERE, '..', 'RosterRow.tsx'), 'utf8');

/**
 * The file with its comments removed. The header explains WHY the fabricated
 * figures are absent, and it names them to do it -- so a raw grep for the
 * trend glyphs finds the explanation and fails. Every source-shape assertion
 * below reads this, the same way the repo's other guards do.
 */
const EXECUTABLE = ROW_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const player = (over: Partial<PressBoxRosterRowPlayer> = {}): PressBoxRosterRowPlayer => ({
  id: 'p1',
  name: 'Connor McDavid',
  teamAbbreviation: 'EDM',
  gameLabel: '@ DAL 8:30',
  todayProjection: 6.9,
  todayActual: null,
  weekPoints: 12.4,
  ...over,
});

const row = (props: Partial<React.ComponentProps<typeof PressBoxRosterRow>> = {}) =>
  render(<PressBoxRosterRow player={player()} slot="C" {...props} />).container;

describe('Press Box roster row — geometry', () => {
  it('is the spec grid at the spec height: 30/30/1fr/52/44, gap 8, min 56', () => {
    // The five columns in order, not a five-column grid of any widths: the
    // chip and the mug are fixed so that names in a column all start at the
    // same x, which is the property that makes a list scannable.
    const withWeek = row({ showWeek: true }).querySelector('[data-testid="pressbox-roster-row"]')!;
    expect(withWeek.className).toContain('grid-cols-[30px_30px_1fr_52px_44px]');
    expect(withWeek.className).toContain('gap-2');
    expect(withWeek.className).toContain('min-h-[56px]');
  });

  it('without a week figure the grid CLOSES rather than printing a dash column', () => {
    // HockeyPlayer carries daily points and a daily projection and nothing
    // weekly. Forty rows of "–" under a WK header occupies 44px, teaches the
    // eye to skip that edge of the row, and reads as broken rather than as
    // not-yet. The column and its width return together when a real figure
    // does.
    const el = row().querySelector('[data-testid="pressbox-roster-row"]')!;
    expect(el.className).toContain('grid-cols-[30px_30px_1fr_52px]');
    expect(el.className).not.toContain('52px_44px');
    expect(row({ showWeek: true }).textContent).toContain('12.4');
    expect(row().textContent).not.toContain('12.4');
  });

  it('the chip is 30px and neutral — the letter carries the position', () => {
    expect(PB_POSITION_CHIP_BASE).toContain('w-[30px]');
    expect(PB_POSITION_CHIP_BASE).toContain('h-[30px]');
    const chip = row().querySelector('button')!;
    expect(chip.className).toContain('bg-white/10');
    // No saturated fill anywhere on the chip.
    expect(/bg-(pastel|pressbox)-(orange|sage|grapefruit|ice)/.test(chip.className)).toBe(false);
  });

  it('every rung on the row comes from the Press Box ladder', () => {
    // A private `text-[13px]` is how a four-step ladder becomes a gradient,
    // and a gradient is the flat row the original audit complained about.
    // The one size declared inline is the WK column (12px), which is a rung
    // between META and HEADLINE that only this screen has -- it is spelled
    // out here so it cannot be added to a second time without argument.
    const sizes = [...EXECUTABLE.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    const fromRungs = [PB_ROW_NAME, PB_ROW_HEADLINE, PB_ROW_META, PB_ROW_MICRO]
      .flatMap((r) => [...r.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1])));
    const allowed = new Set([...fromRungs, 12, 8]);
    expect(sizes.filter((s) => !allowed.has(s)), 'a size that is not on the ladder').toEqual([]);
  });

  it('no label on the row is under 10px except the swap glyph, which is a symbol', () => {
    // The repo's accessibility floor. 8px is permitted for the swap arrow
    // alone: it is a shape a manager recognises, not text anyone reads.
    const eightPx = [...EXECUTABLE.matchAll(/text-\[8px\][^\n]*/g)].map((m) => m[0]);
    expect(eightPx.length, 'exactly one 8px use').toBe(1);
    expect(EXECUTABLE).toContain('⇄');
  });
});

describe('Press Box roster row — the colour contract', () => {
  it('a projection is orange-soft; a score that happened is sage', () => {
    const proj = row().querySelector('[data-testid="pressbox-roster-row"]')!.textContent;
    expect(proj).toContain('6.9');
    const projEl = row().querySelectorAll('span');
    const projected = [...projEl].some((s) => s.className.includes('text-pressbox-orange-soft'));
    expect(projected, 'a forecast wears orange-soft').toBe(true);

    const live = row({
      player: player({ isLiveOrFinal: true, todayActual: 8.2, statLine: '1G 2A 4S', gameLabel: 'vs TOR 3RD' }),
    });
    const happened = [...live.querySelectorAll('span')].some((s) =>
      s.className.includes('text-pressbox-sage'),
    );
    expect(happened, 'a fact wears sage').toBe(true);
    expect(live.textContent).toContain('8.2');
  });

  it('team colour reaches the row as a ring on the mug and nothing else', () => {
    const el = row().querySelector('[data-team-ring]') as HTMLElement;
    expect(el.getAttribute('data-team-ring')).toBe('EDM');
    expect(el.style.boxShadow).toContain('1.5px');
    // The rule the contrast guard enforces repo-wide, asserted here at the
    // one place on the phone that carries a team colour at all.
    expect(/backgroundColor:\s*teamColor|background:\s*teamColor/.test(EXECUTABLE)).toBe(false);
  });

  it('a bench row keeps its real number and says it does not count', () => {
    const el = row({ slot: 'BN', countsForScoring: false, player: player({ isLiveOrFinal: true, todayActual: 8.2 }) });
    expect(el.textContent).toContain('8.2');
    const dimmed = [...el.querySelectorAll('span')].some((s) => s.className.includes('text-pressbox-text/50'));
    expect(dimmed, 'a bench figure is dimmed, not hidden or recoloured to sage').toBe(true);
  });

  it('DTD tints the row and turns the meta grapefruit', () => {
    const el = row({ dtd: true, player: player({ status: 'GTD' }) });
    const rowEl = el.querySelector('[data-testid="pressbox-roster-row"]')!;
    expect(rowEl.className).toContain('bg-[rgba(255,111,128,0.05)]');
    const meta = [...el.querySelectorAll('span')].some((s) =>
      s.className.includes('text-pressbox-grapefruit-text'),
    );
    expect(meta).toBe(true);
  });
});

describe('Press Box roster row — numbers that do not exist are not printed', () => {
  it('ownership percentages are absent, and so is the separator that led them', () => {
    // The spec asks for `100% · 99% |` before the game line and names the gap
    // in the same breath: no league-wide rostered/started aggregate exists.
    // A bare leading `|` reads as a rendering bug, so both go.
    const el = row();
    const text = el.textContent || '';
    expect(/\d+%/.test(text), 'no percentage is printed').toBe(false);
    expect(text.trimStart().startsWith('|'), 'no orphan separator').toBe(false);
  });

  it('but the segment renders the day the aggregate lands', () => {
    const el = row({ showOwnership: true, rosteredPct: 100, startedPct: 99 });
    expect(el.textContent).toContain('100%');
    expect(el.textContent).toContain('99%');
  });

  it('no week-over-week trend is fabricated', () => {
    // The spec's `▲ 12%` / `▼ 31%` micro needs a prior-week figure the roster
    // payload does not carry. Absent until it does.
    expect(EXECUTABLE).not.toContain('▲');
    expect(EXECUTABLE).not.toContain('▼');
  });
});

describe('Press Box roster row — every tap target is a control with a name', () => {
  it('the slot and the name are buttons, each with an aria-label', () => {
    const el = row();
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      expect(b.getAttribute('aria-label'), 'every tap target is named').toBeTruthy();
    }
    expect(buttons[0].getAttribute('aria-label')).toContain('Change lineup');
    expect(buttons[1].getAttribute('aria-label')).toContain('Connor McDavid');
  });

  it('an empty slot is one control, and it says what tapping does', () => {
    const el = render(<PressBoxRosterRow player={null} slot="LW" />).container;
    const btn = el.querySelector('[role="button"]')!;
    expect(btn.getAttribute('aria-label')).toBe('Empty LW, tap to fill');
  });

  it('no aria-label carries an em dash', () => {
    // aiVoiceGuard reads aria-labels as user-facing copy, and it is right to.
    const labels = [...EXECUTABLE.matchAll(/aria-label=\{?[`"']([^`"']+)/g)].map((m) => m[1]);
    expect(labels.filter((l) => l.includes('—'))).toEqual([]);
  });
});

// ── The list around the rows ──────────────────────────────────────────────

describe('Press Box roster list', () => {
  const slotRow = (over: Partial<PressBoxRosterSlotRow> = {}): PressBoxRosterSlotRow => ({
    slotId: 'c-1',
    slot: 'C',
    player: player(),
    ...over,
  });

  const list = (over: Partial<React.ComponentProps<typeof PressBoxRosterList>> = {}) =>
    render(
      <PressBoxRosterList
        days={['THU', 'FRI', 'SAT', 'WEEK']}
        activeDay="THU"
        starters={[slotRow()]}
        bench={[slotRow({ slotId: 'bn-1', slot: 'BN' })]}
        startersFilled={13}
        startersRequired={13}
        {...over}
      />,
    ).container;

  it('the starters count is filled-over-required, not the number of rows drawn', () => {
    // A list that draws twelve players and one empty slot must say 12/13. If
    // this were derived from rows.length it would say 13/13 and hide the hole
    // it is rendering -- the one thing the header exists to surface.
    const el = list({
      starters: [slotRow(), slotRow({ slotId: 'lw-1', slot: 'LW', player: null })],
      startersFilled: 12,
      startersRequired: 13,
    });
    expect(el.textContent).toContain('12/13');
  });

  it('the bench note appears only when someone on the bench is playing', () => {
    expect(list({ benchPlayingCount: 0 }).textContent).not.toContain('playing tonight');
    const warned = list({ benchPlayingCount: 2 }).textContent || '';
    expect(warned).toContain('2 playing tonight');
    expect(warned.toLowerCase()).toContain("pts don't count");
  });

  it('the day toggles are a tablist and exactly one is selected', () => {
    const el = list({ activeDay: 'SAT' });
    const tabs = [...el.querySelectorAll('[role="tab"]')];
    expect(tabs.length).toBe(4);
    const on = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(on.length).toBe(1);
    expect(on[0].textContent).toBe('SAT');
  });

  it('the column header wears the row grid, so labels land over their numbers', () => {
    const header = [...list({ showWeek: true }).querySelectorAll('div')].find(
      (d) => d.className.includes('grid-cols-[30px_30px_1fr_52px_44px]') && d.getAttribute('aria-hidden') === 'true',
    );
    expect(header, 'a header on the row grid').toBeDefined();
    expect((header!.textContent || '').toLowerCase()).toContain('today');
  });

  it('bench rows dim their number; starter rows do not', () => {
    const el = list({
      starters: [slotRow({ player: player({ isLiveOrFinal: true, todayActual: 8.2 }) })],
      bench: [slotRow({ slotId: 'bn-1', slot: 'BN', player: player({ isLiveOrFinal: true, todayActual: 4.1 }) })],
    });
    const rows = [...el.querySelectorAll('[data-testid="pressbox-roster-row"]')];
    expect(rows.length).toBe(2);
    const dim = (r: Element) =>
      [...r.querySelectorAll('span')].some((s) => s.className.includes('text-pressbox-text/50'));
    expect(dim(rows[0]), 'a starter figure is not dimmed').toBe(false);
    expect(dim(rows[1]), 'a bench figure is dimmed').toBe(true);
  });
});
