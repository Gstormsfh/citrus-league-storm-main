/**
 * PRESS BOX ROSTER ROW GUARD — pinned to the reference, not to a summary.
 *
 * The first version of this file asserted the values I had built; this one
 * asserts the values the ARTBOARD carries. `Citrus Redesign - Directions.dc.html`
 * styles every node inline, so the spec is literal and quotable, and each
 * block below quotes the rule it is pinning. When the row and the artboard
 * disagree, this file is what says so.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PressBoxRosterRow, type PressBoxRosterRowPlayer } from '../RosterRow';
import { PressBoxRosterList, type PressBoxRosterSlotRow } from '../RosterList';
import { PressBoxTeamCard } from '../PressBoxTeamCard';
import { PB_ROW_HEADLINE, PB_ROW_META, PB_ROW_NAME } from '../rowScale';
import { PB_POSITION_CHIP_BASE } from '../positionChip';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const ROW_SRC = readFileSync(resolve(HERE, '..', 'RosterRow.tsx'), 'utf8');
const EXECUTABLE = ROW_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const player = (over: Partial<PressBoxRosterRowPlayer> = {}): PressBoxRosterRowPlayer => ({
  id: 'p1',
  name: 'Connor McDavid',
  teamAbbreviation: 'EDM',
  gameLabel: 'vs TOR 3RD',
  statLine: '1G 2A',
  isLiveOrFinal: true,
  todayActual: 8.4,
  todayProjection: 6.9,
  weekPoints: 31.2,
  weekTrendPct: 12,
  rosteredPct: 100,
  startedPct: 99,
  ...over,
});

const row = (props: Partial<React.ComponentProps<typeof PressBoxRosterRow>> = {}) =>
  render(<PressBoxRosterRow player={player()} slot="C" showWeek showOwnership {...props} />).container;

const rowEl = (c: HTMLElement) => c.querySelector('[data-testid="pressbox-roster-row"]')!;
const spans = (c: HTMLElement) => [...c.querySelectorAll('span')];
const hasClass = (c: HTMLElement, cls: string) => spans(c).some((s) => s.className.includes(cls));

describe('the row is the artboard grid', () => {
  it('30px 30px 1fr 52px 44px, gap 8, min 56, hairline on TOP', () => {
    // display:grid;grid-template-columns:30px 30px 1fr 52px 44px;gap:8px;
    // align-items:center;min-height:56px;
    // border-top:1px solid rgba(255,255,255,.06)
    const el = rowEl(row());
    expect(el.className).toContain('grid-cols-[30px_30px_1fr_52px_44px]');
    expect(el.className).toContain('gap-2');
    expect(el.className).toContain('min-h-[56px]');
    expect(el.className).toContain('border-t');
    expect(el.className).toContain('border-white/[0.06]');
  });

  it('carries NO horizontal padding — the gutter is the section’s', () => {
    // The artboard wraps the section in padding:10px 12px 0 and gives the row
    // none, so the hairline runs the full column and the header labels sit
    // over their numbers. A px-3 on the row would inset every rule by 12px.
    expect(rowEl(row()).className).not.toMatch(/\bpx-\d/);
  });

  it('a bench row is 52px, not 56', () => {
    expect(rowEl(row({ bench: true })).className).toContain('min-h-[52px]');
  });
});

describe('the chip is a flat fill with a glyph under the letter', () => {
  it('30px, radius 6, Barlow Condensed 800 11px, and NO ring', () => {
    // width:30px;height:30px;border-radius:6px;background:rgba(255,255,255,.1);
    // font:800 11px 'Barlow Condensed';flex-direction:column;line-height:1
    expect(PB_POSITION_CHIP_BASE).toContain('w-[30px]');
    expect(PB_POSITION_CHIP_BASE).toContain('h-[30px]');
    // rounded-[6px], not rounded-md: this config remaps the radius scale, so
    // `md` is 14px here. Every Press Box radius is written in pixels.
    expect(PB_POSITION_CHIP_BASE).toContain('rounded-[6px]');
    expect(PB_POSITION_CHIP_BASE).not.toMatch(/rounded-(sm|md|lg|xl)\b/);
    expect(PB_POSITION_CHIP_BASE).toContain('font-condensed');
    expect(PB_POSITION_CHIP_BASE).toContain('text-[11px]');
    expect(PB_POSITION_CHIP_BASE).toContain('font-extrabold');
    // The ring was carried over from the legacy chip and is not in the
    // artboard. Two rings beside a mug that means something is one too many.
    expect(PB_POSITION_CHIP_BASE).not.toContain('ring');
  });

  it('a starter stacks the 8px swap glyph; a bench chip has none', () => {
    const starter = row().querySelector('button')!;
    expect(starter.className).toContain('flex-col');
    expect(starter.textContent).toContain('⇄');
    expect(starter.className).toContain('bg-white/10');

    const benched = row({ bench: true, slot: 'BN' }).querySelector('button')!;
    expect(benched.textContent).not.toContain('⇄');
    expect(benched.className).toContain('bg-white/[0.08]');
    expect(benched.className).toContain('text-pressbox-text/55');
  });

  it('a locked starter wears the lock where the glyph goes', () => {
    const el = row({ locked: true });
    expect(el.querySelector('button')!.textContent).not.toContain('⇄');
    expect(el.querySelector('svg')).toBeTruthy();
  });
});

describe('the name line carries the team code', () => {
  it('name Barlow 700 15px, truncating, with the code as a 10px mono suffix', () => {
    // font:700 15px Barlow + <span font:500 10px 'IBM Plex Mono' at .5>EDM
    expect(PB_ROW_NAME).toContain('text-[15px]');
    expect(PB_ROW_NAME).toContain('font-barlow');
    expect(PB_ROW_NAME).toContain('truncate');
    const el = row();
    expect(el.textContent).toContain('Connor McDavid');
    const code = spans(el).find((s) => s.textContent === 'EDM')!;
    expect(code.className).toContain('text-[10px]');
    expect(code.className).toContain('font-plex');
    expect(code.className).toContain('text-pressbox-text/50');
  });

  it('a bench row prints the position after the team, because the chip says BN', () => {
    // <span ...>MTL · C</span>
    const el = row({ bench: true, slot: 'BN', player: player({ teamAbbreviation: 'MTL', positionsLabel: 'C' }) });
    expect(el.textContent).toContain('MTL · C');
  });

  it('a starter does NOT repeat the position — its chip already said it', () => {
    const el = row({ player: player({ teamAbbreviation: 'MTL', positionsLabel: 'C' }) });
    expect(el.textContent).not.toContain('MTL · C');
  });
});

describe('the meta line', () => {
  it('is 10px mono at .55, truncating, ownership then a .25 pipe then the game', () => {
    // font:500 10px 'IBM Plex Mono';color:rgba(243,239,230,.55);margin-top:2px
    // 100% · 99% <span .25>|</span> <span #84A57D>vs TOR 3RD · 1G 2A</span>
    expect(PB_ROW_META).toContain('text-[10px]');
    expect(PB_ROW_META).toContain('font-plex');
    expect(PB_ROW_META).toContain('text-ellipsis');
    const el = row();
    expect(el.textContent).toContain('100% · 99%');
    expect(el.textContent).toContain('|');
    expect(el.textContent).toContain('vs TOR 3RD · 1G 2A');
    expect(hasClass(el, 'text-pressbox-text/25')).toBe(true);
    expect(hasClass(el, 'text-pressbox-sage')).toBe(true);
  });

  it('with no game on the day, the percentages stand alone: no trailing pipe', () => {
    // A day off (or a day before the opener) has no game label and no stat
    // line; `100% · 99% |` with nothing after it read as a broken row.
    const el = row({ player: player({ gameLabel: undefined, statLine: undefined, isLiveOrFinal: false, todayActual: null }) });
    expect(el.textContent).toContain('100% · 99%');
    expect(el.textContent).not.toContain('|');
  });

  it('with ownership off, the percentages AND the pipe both go', () => {
    // A bare leading pipe reads as a rendering bug, not a placeholder.
    // The WK trend also ends in a %, so the check is for the ownership PAIR.
    const el = row({ showOwnership: false });
    expect(/\d+% · \d+%/.test(el.textContent || '')).toBe(false);
    expect(el.textContent).not.toContain('|');
    expect(el.textContent).toContain('vs TOR 3RD');
  });

  it('DTD turns the whole meta grapefruit and tints the row', () => {
    // background:rgba(255,111,128,.05) on the row; color:#FF8A98 on the meta;
    // the badge is font:700 9px Plex on rgba(255,111,128,.18)
    const el = row({ dtd: true, player: player({ status: 'GTD' }) });
    expect(rowEl(el).className).toContain('bg-[rgba(255,111,128,0.05)]');
    expect(hasClass(el, 'text-pressbox-grapefruit-text')).toBe(true);
    const badge = spans(el).find((s) => s.textContent === 'GTD')!;
    expect(badge.className).toContain('text-[9px]');
    expect(badge.className).toContain('bg-pressbox-grapefruit/[0.18]');
  });
});

describe('TODAY: the unit says whether it has happened', () => {
  it('a live number is sage over "P 6.9" — the projection it is beating', () => {
    expect(PB_ROW_HEADLINE).toContain('text-[17px]');
    const el = row();
    expect(el.textContent).toContain('8.4');
    expect(el.textContent).toContain('P 6.9');
    expect(hasClass(el, 'text-pressbox-sage')).toBe(true);
  });

  it('a forecast is orange-soft over the word PROJ, not over a second copy of itself', () => {
    // font:600 17px Plex #FF9F66 / font:500 9px Plex .45 "PROJ"
    const el = row({ player: player({ isLiveOrFinal: false, todayActual: null, todayProjection: 6.2 }) });
    expect(el.textContent).toContain('6.2');
    expect(el.textContent).toContain('PROJ');
    expect(el.textContent).not.toContain('P 6.2');
    expect(hasClass(el, 'text-pressbox-orange-soft')).toBe(true);
  });

  it('nothing to show is an en dash at .5 with the projection still under it', () => {
    // <div ... color:rgba(243,239,230,.5)>–</div><div ...>P 0.0</div>
    const el = row({ player: player({ isLiveOrFinal: true, todayActual: null, todayProjection: 0 }) });
    expect(el.textContent).toContain('–');
    expect(el.textContent).toContain('P 0.0');
  });

  it('a bench figure is real and dimmed, never recoloured to sage', () => {
    // The NUMBER is dimmed. The stat line beside it stays sage -- the
    // artboard's own bench row prints `vs OTT 1ST · 1A` in #84A57D, because
    // what happened still happened; it just does not count for you.
    const el = row({ bench: true, slot: 'BN', player: player({ todayActual: 2.0, todayProjection: 4.9 }) });
    expect(el.textContent).toContain('2.0');
    expect(el.textContent).toContain('P 4.9');
    const headline = spans(el).find((s) => s.textContent === '2.0')!;
    expect(headline.className).toContain('text-pressbox-text/50');
    expect(headline.className).not.toContain('text-pressbox-sage');
  });
});

describe('WK: the number and which way it is going', () => {
  it('12px at .85 with a 9px trend under it', () => {
    // text-align:right;font:600 12px Plex;color:rgba(243,239,230,.85)
    //   <div font:500 9px Plex;color:#84A57D>▲ 12%</div>
    const el = row();
    expect(el.textContent).toContain('31.2');
    expect(el.textContent).toContain('▲ 12%');
    expect(hasClass(el, 'text-[12px]')).toBe(true);
  });

  it('a fall is grapefruit, flat is muted, and zero is "— 0%" not nothing', () => {
    expect(row({ player: player({ weekTrendPct: -31 }) }).textContent).toContain('▼ 31%');
    const flat = row({ player: player({ weekTrendPct: 0 }) });
    expect(flat.textContent).toContain('– 0%');
    expect(hasClass(flat, 'text-pressbox-text/45')).toBe(true);
  });

  it('no trend figure prints no trend, and never a zero standing in for one', () => {
    const el = row({ player: player({ weekTrendPct: null }) });
    expect(el.textContent).toContain('31.2');
    expect(el.textContent).not.toContain('▲');
    expect(el.textContent).not.toContain('– 0%');
  });

  it('a bench row shows the week total with no trend at all', () => {
    const el = row({ bench: true, slot: 'BN', player: player({ weekPoints: 9.1, weekTrendPct: 12 }) });
    expect(el.textContent).toContain('9.1');
    expect(el.textContent).not.toContain('▲');
  });

  it('with the column off the grid closes to four, and the figure is gone', () => {
    const el = row({ showWeek: false });
    expect(rowEl(el).className).toContain('grid-cols-[30px_30px_1fr_52px]');
    expect(el.textContent).not.toContain('31.2');
  });
});

describe('the mug is the only team colour, and it is a border', () => {
  it('30px including a 1.5px border, coloured by the team', () => {
    // width:30px;height:30px;border-radius:50%;border:1.5px solid ...
    const el = row().querySelector('[data-team-ring]') as HTMLElement;
    expect(el.getAttribute('data-team-ring')).toBe('EDM');
    expect(el.className).toContain('w-[30px]');
    expect(el.className).toContain('border-[1.5px]');
    expect(el.className).toContain('box-border');
    expect(el.style.borderColor).toBeTruthy();
    // Never a fill or a bar, which is what the contrast guard forbids.
    expect(/backgroundColor:\s*teamColor|background:\s*teamColor/.test(EXECUTABLE)).toBe(false);
  });
});

describe('every tap target is a named control', () => {
  it('the slot and the name are buttons with aria-labels, and no em dashes', () => {
    const buttons = [...row().querySelectorAll('button')];
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-label')).toContain('Change lineup');
    expect(buttons[1].getAttribute('aria-label')).toContain('Connor McDavid');
    const labels = [...EXECUTABLE.matchAll(/aria-label=\{?[`"']([^`"']+)/g)].map((m) => m[1]);
    expect(labels.filter((l) => l.includes('—'))).toEqual([]);
  });

  it('an empty slot is one control that says what tapping does', () => {
    const el = render(<PressBoxRosterRow player={null} slot="LW" />).container;
    expect(el.querySelector('[role="button"]')!.getAttribute('aria-label')).toBe('Empty LW, tap to fill');
  });
});

describe('the team card', () => {
  const card = (over = {}) =>
    render(
      <PressBoxTeamCard
        teamName="Gstorms"
        record="4–1"
        rank="2ND"
        winPct={64}
        yourScore={118.4}
        theirScore={96.1}
        actions={[
          { glyph: '⚡', label: 'Optimize', primary: true },
          { glyph: '⇄', label: 'Trade' },
          { glyph: '+', label: 'Add' },
          { glyph: '☰', label: 'Log' },
        ]}
        {...over}
      />,
    ).container;

  it('is the tile the artboard draws: #16241B, hairline, radius 14', () => {
    const el = card().firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-pressbox-tile');
    expect(el.className).toContain('rounded-[14px]');
    expect(el.className).toContain('border-white/[0.08]');
  });

  it('the bar grows YOUR orange from the left over THEIR ice', () => {
    // background:#8DCDFF with an inner width:64%;background:#FF6B1A
    const el = card();
    const track = spans(el).find((s) => s.className.includes('bg-pressbox-ice'))!;
    const fill = track.querySelector('span') as HTMLElement;
    expect(fill.className).toContain('bg-pressbox-orange');
    expect(fill.style.width).toBe('64%');
    expect(el.textContent).toContain('64% WIN');
    expect(el.textContent).toContain('118.4 · 96.1');
  });

  it('the leading score is sage; the trailing one is not', () => {
    expect(hasClass(card(), 'text-pressbox-sage')).toBe(true);
    expect(hasClass(card({ yourScore: 96.1, theirScore: 118.4 }), 'text-pressbox-sage')).toBe(false);
  });

  it('exactly one action is orange, and it is the primary one', () => {
    const orange = [...card().querySelectorAll('button')].filter((b) =>
      b.className.includes('bg-pressbox-orange'),
    );
    expect(orange.length).toBe(1);
    expect(orange[0].textContent).toContain('Optimize');
  });

  it('draws no bar rather than a 50% one when there is no probability yet', () => {
    const el = card({ winPct: null });
    expect(el.textContent).toContain('Gstorms');
    expect(hasClass(el, 'bg-pressbox-ice')).toBe(false);
  });
});

describe('the list around the rows', () => {
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
        showWeek
        {...over}
      />,
    ).container;

  it('owns the 12px gutter the rows do not carry', () => {
    expect((list().firstElementChild as HTMLElement).className).toContain('px-3');
  });

  it('the starters count is filled-over-required, not the number of rows drawn', () => {
    const el = list({
      starters: [slotRow(), slotRow({ slotId: 'lw-1', slot: 'LW', player: null })],
      startersFilled: 12,
      startersRequired: 13,
    });
    expect(el.textContent).toContain('· 12/13');
  });

  it('the column header wears the row grid and names the ownership columns only when they exist', () => {
    const plain = [...list().querySelectorAll('div')].find(
      (d) => d.getAttribute('aria-hidden') === 'true' && d.className.includes('grid-cols-'),
    )!;
    expect(plain.className).toContain('grid-cols-[30px_30px_1fr_52px_44px]');
    expect(plain.textContent).toContain('Player');
    expect(plain.textContent).not.toContain('Ros%');
    expect(list({ showOwnership: true }).textContent).toContain('Ros% / Start%');
  });

  it('the bench note appears only when someone on the bench is playing', () => {
    expect(list({ benchPlayingCount: 0 }).textContent).not.toContain('playing tonight');
    expect(list({ benchPlayingCount: 2 }).textContent).toContain('2 playing tonight');
  });

  it('the day toggles are a tablist with exactly one selected', () => {
    const tabs = [...list({ activeDay: 'SAT' }).querySelectorAll('[role="tab"]')];
    expect(tabs.length).toBe(4);
    const on = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(on.length).toBe(1);
    expect(on[0].textContent).toBe('SAT');
  });
});
