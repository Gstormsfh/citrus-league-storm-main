/**
 * PHONE ROW TYPE SCALE GUARD (2026-09-02).
 *
 * The audit finding this exists to keep fixed, verbatim:
 *
 *   "Roster / Matchup rows: type scale 10-13px vs Sleeper 15-20px; headline
 *    numbers not dominant."
 *
 * The fix was a LADDER, not a bump — name 15px, headline number 17px mono,
 * metadata 12px, micro labels 10px, one vocabulary across the three list
 * rows a manager reads on a phone (`src/components/phoneRowScale.ts`). A
 * ladder is a fragile thing to own: any single edit that nudges one rung
 * toward its neighbour flattens the row again, and nothing about a flat row
 * fails a rendering test. So this file pins the RELATIONSHIP as well as the
 * values:
 *
 *   * the four rungs are strictly ordered, and the headline number is
 *     bigger than the name on every surface — that is what "dominant"
 *     means and it is the property the audit says we lost;
 *   * each of the three rows actually climbs the shared ladder rather than
 *     hard-coding a private size;
 *   * nothing on those rows sits between two rungs (a fifth size is how a
 *     four-step ladder becomes a gradient, and a gradient is a flat row).
 *
 * jsdom has no layout engine, so heights and collisions are measured in the
 * harness (`apps/web/harness/README.md`) and the OUTCOME is pinned here as
 * a class contract — the pattern darkThemeContrastGuard and
 * matchupMobileRowsGuard already use.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

// FreeAgentRow's game line reaches ScheduleService (pure), but importing it
// pulls the API client, whose Supabase client throws at module scope under
// the suite's hermetic (empty) env. Same stub FreeAgentRow.test.tsx uses.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
}));

import {
  ROW_HEADLINE,
  ROW_HEADLINE_LABEL,
  ROW_META,
  ROW_MICRO,
  ROW_NAME,
} from '@/components/phoneRowScale';
import { FA_NAME, FA_PROJ, FA_RANK, FA_SUB } from '@/components/freeagents/freeAgentRowKit';
import { FreeAgentRow } from '@/components/freeagents/FreeAgentRow';
import MobileRosterList from '@/components/roster/MobileRosterList';
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

const SRC = resolve(fileURLToPath(import.meta.url), '..', '..');
const CSS = readFileSync(resolve(SRC, 'index.css'), 'utf8');

/** The single `text-[Npx]` a rung declares. Throws if a rung grows a second. */
function px(rung: string): number {
  const all = [...rung.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
  expect(all.length, `a rung must declare exactly one size: "${rung}"`).toBe(1);
  return all[0];
}

// ── The ladder itself ─────────────────────────────────────────────────────

describe('phoneRowScale — four rungs, strictly ordered', () => {
  it('is the scale the audit asked for: 17 / 15 / 12 / 10', () => {
    // The audit's band for a headline number is 17-20px and for a name
    // 15-16px. 17 rather than 20 is a fit decision the module explains: the
    // mobile matchup row shows TWO players at 393px, so each score column
    // is 42px and a four-figure total at 18px (43.2px in JetBrains Mono)
    // does not fit. These are the values, and they are pinned so a "just
    // one pixel" edit has to argue with this comment first.
    expect(px(ROW_HEADLINE)).toBe(17);
    expect(px(ROW_NAME)).toBe(15);
    expect(px(ROW_META)).toBe(12);
    expect(px(ROW_MICRO)).toBe(10);
    expect(px(ROW_HEADLINE_LABEL)).toBe(10);
  });

  it('the headline number is bigger than the name, which is bigger than the metadata', () => {
    // The finding was "headline numbers not dominant" — before this change
    // the roster row was name 13 / number 15 and the matchup card was 14/15.
    // A strict ordering with a real gap is the property, not the numbers.
    expect(px(ROW_HEADLINE)).toBeGreaterThan(px(ROW_NAME));
    expect(px(ROW_NAME)).toBeGreaterThan(px(ROW_META));
    expect(px(ROW_META)).toBeGreaterThan(px(ROW_MICRO));
    expect(px(ROW_HEADLINE) - px(ROW_NAME)).toBeGreaterThanOrEqual(2);
  });

  it('the headline number is mono and tabular, so a column of them lines up', () => {
    expect(ROW_HEADLINE).toContain('font-jbmono');
    expect(ROW_HEADLINE).toContain('tabular-nums');
    expect(ROW_HEADLINE).toContain('font-bold');
    // NOT font-varsity: index.css colours `.font-varsity:not(button)` cream
    // at a specificity that beats every text-* utility, which is how the
    // roster's projections and final scores ended up the same colour.
    expect(ROW_HEADLINE).not.toContain('font-varsity');
  });

  it('carries no colour — colour lives in the .tsx where the contrast guard can read it', () => {
    // darkThemeContrastGuard walks *.tsx only. A colour parked in this .ts
    // would be a colour no guard checks.
    const scale = readFileSync(resolve(SRC, 'components/phoneRowScale.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(scale).not.toMatch(/\btext-(?:white|pastel|citrus|emerald|red|amber)[\w/-]*/);
  });
});

// ── Surface 1: the phone roster list ──────────────────────────────────────

const rosterPlayer = (over: Partial<HockeyPlayer> = {}): HockeyPlayer =>
  ({
    id: '1',
    name: 'Connor McDavid',
    position: 'C',
    number: 97,
    starter: true,
    team: 'Edmonton Oilers',
    teamAbbreviation: 'EDM',
    stats: {},
    daily_projection: { total_projected_points: 5.2 },
    nextGame: { opponent: 'vs TOR', isToday: true, gameTime: '7:30 PM', gameStatus: 'scheduled' },
    ...over,
  }) as HockeyPlayer;

const renderRoster = (p: HockeyPlayer) =>
  render(
    <MobileRosterList
      starters={[p]}
      bench={[]}
      ir={[]}
      slotAssignments={{ [String(p.id)]: 'slot-C-1' }}
      positionType="individual"
      irSlotCount={0}
    />,
  );

describe('MobileRosterList climbs the ladder', () => {
  it('the name is the NAME rung and the projection is the HEADLINE rung', () => {
    renderRoster(rosterPlayer());
    expect(screen.getByText('Connor McDavid').className).toContain(`text-[${px(ROW_NAME)}px]`);

    const pts = screen.getByText('5.2');
    expect(pts.className).toContain(`text-[${px(ROW_HEADLINE)}px]`);
    expect(pts.className).toContain('font-jbmono');
    expect(pts.className).toContain('tabular-nums');
    // A forecast is orange; the varsity face used to overrule this to cream.
    expect(pts.className).toContain('text-pastel-orange');
  });

  it('a live number is sage and still the HEADLINE rung — one state colour, one size', () => {
    renderRoster(
      rosterPlayer({
        nextGame: { opponent: 'vs TOR', isToday: true, gameStatus: 'final', score: '4-2' },
        daily_actual_points: 10.8,
        daily_actual_stats: { goals: 1, assists: 2, shots_on_goal: 5 },
      } as Partial<HockeyPlayer>),
    );
    const pts = screen.getByText('10.8');
    expect(pts.className).toContain(`text-[${px(ROW_HEADLINE)}px]`);
    expect(pts.className).toContain('text-pastel-sage');
    // text-emerald-700 measured 2.71:1 on the #1A2A20 tile and was invisible
    // only because font-varsity was overriding it to cream. It never comes
    // back on this row.
    expect(pts.className).not.toContain('emerald');
  });

  it('the game line is the META rung and sits below the name, not beside it', () => {
    renderRoster(rosterPlayer());
    const teamLine = screen.getByText('EDM').parentElement!;
    expect(teamLine.className).toContain(`text-[${px(ROW_META)}px]`);
    expect(px(ROW_META)).toBeLessThan(px(ROW_NAME));
  });

  it('no size on the row sits between two rungs', () => {
    // A fifth size is how a four-step ladder turns back into a gradient.
    // Only the row's own type is in scope: `text-sm` on the section headers
    // is page chrome, and the position chip's 11px letter / 10px glyph are
    // pinned by MobileRosterList.positionRing + swapAffordance.
    const { container } = renderRoster(rosterPlayer());
    const row = screen.getByText('Connor McDavid').closest('div.flex.items-center.gap-2\\.5')!;
    const allowed = new Set([px(ROW_NAME), px(ROW_HEADLINE), px(ROW_META), px(ROW_MICRO), 11]);
    const seen: number[] = [];
    for (const el of [row, ...Array.from(row.querySelectorAll('*'))]) {
      for (const m of el.className.toString().matchAll(/text-\[(\d+)px\]/g)) seen.push(Number(m[1]));
    }
    expect(seen.length, 'the row declares no explicit sizes at all — did the query break?').toBeGreaterThan(3);
    expect(seen.filter((n) => !allowed.has(n)), `off-ladder sizes: ${seen.join(', ')}`).toEqual([]);
    container.remove();
  });
});

// ── Surface 2: the Free Agents row ────────────────────────────────────────

describe('FreeAgentRow climbs the same ladder', () => {
  const player = {
    id: 'p1',
    full_name: 'Connor McDavid',
    position: 'C',
    team: 'EDM',
  };

  it('its geometry constants are COMPOSED from the scale, not restated', () => {
    // Restating "text-[15px]" here is exactly how the three surfaces drift
    // apart again; the string has to contain the rung, not merely match it.
    expect(FA_NAME).toContain(ROW_NAME);
    expect(FA_PROJ).toContain(ROW_HEADLINE);
    expect(FA_RANK).toContain(`text-[${px(ROW_MICRO)}px]`);
    expect(FA_SUB).toContain(`text-[${px(ROW_MICRO)}px]`);
  });

  it('renders the name at NAME and the projection at HEADLINE', () => {
    render(
      <FreeAgentRow
        rank={1}
        player={player}
        projection={12.3}
        todayStr="2026-09-02"
        action="add"
        onOpen={() => {}}
        onAction={() => {}}
      />,
    );
    expect(screen.getByText('Connor McDavid').className).toContain(`text-[${px(ROW_NAME)}px]`);
    const proj = screen.getByTestId('fa-projection');
    expect(proj.className).toContain(`text-[${px(ROW_HEADLINE)}px]`);
    expect(proj.className).toContain('tabular-nums');
  });
});

// ── Surface 3: the mobile matchup card (its name lives in index.css) ──────

describe('the mobile matchup card climbs the same ladder', () => {
  /**
   * Every innermost `selector { body }` inside every `@media (max-width:
   * 1023px)` block — the same walk matchupMobileRowsGuard does, because
   * there is more than one such block and the matchup rules live in the
   * last one.
   */
  const mobileRules = (() => {
    const out: { selector: string; body: string }[] = [];
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const marker = '@media (max-width: 1023px)';
    let start = css.indexOf(marker);
    while (start !== -1) {
      let depth = 0;
      let i = css.indexOf('{', start);
      const open = i;
      for (; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) break;
      }
      const block = css.slice(open + 1, i);
      const re = /([^{}]+?)\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(block))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
      start = css.indexOf(marker, i);
    }
    return out;
  })();

  /** The concatenated bodies of every mobile rule for one exact selector. */
  const mobileRule = (selector: string) =>
    mobileRules
      .filter((r) => r.selector.split(',').map((x) => x.trim()).includes(selector))
      .map((r) => r.body)
      .join(';');

  it('the phone name is the NAME rung — in rem, because CSS cannot import the module', () => {
    const body = mobileRule('.player-card .player-name');
    expect(body, '.player-card .player-name has no mobile rule').not.toBe('');
    const m = body.match(/font-size:\s*([\d.]+)rem/);
    expect(m, `no rem font-size in: ${body}`).toBeTruthy();
    expect(Number(m![1]) * 16).toBe(px(ROW_NAME));
  });

  it('the phone team line is the META rung', () => {
    const m = mobileRule('.player-card .player-team-name').match(/font-size:\s*([\d.]+)rem/);
    expect(m).toBeTruthy();
    expect(Number(m![1]) * 16).toBe(px(ROW_META));
  });

  it('the score stack still owns its own type — the stylesheet forces none', () => {
    // Pinned by matchupMobileRowsGuard too; repeated here because the whole
    // ladder collapses the moment index.css starts setting sizes over the
    // component again (it used to force `color` and every number went orange).
    expect(mobileRule('.player-card .player-mobile-score')).not.toMatch(/font-size\s*:/);
  });

  it('PlayerCard builds its score class from the shared rung', () => {
    const src = readFileSync(resolve(SRC, 'components/matchup/PlayerCard.tsx'), 'utf8');
    expect(src).toMatch(/SCORE_ACTUAL_CLASS\s*=\s*`player-score-value \$\{ROW_HEADLINE\}`/);
    expect(src).toMatch(/from ["']@\/components\/phoneRowScale["']/);
  });
});
