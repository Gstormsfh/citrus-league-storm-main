// DraftKitService — the contract that makes the Draft Kit sellable and honest.
//
// Two things are worth pinning here and nothing else really is:
//
//   1. THE COHORT RULE. A percentile taken across positions is a wrong number
//      that looks right, and it is the failure this codebase cares most about.
//      The tests below construct a fixture where pooling F and D would produce
//      a visibly different answer, so a regression cannot pass by coincidence.
//   2. THE GATE. An unentitled caller must not receive the paid numbers in any
//      form. Asserting "locked === true" would not catch a payload that ships
//      the data anyway, so the tests assert on the absence of the values.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DraftKitService,
  cohortOf,
  percentileIn,
  tierAtLeast,
  tierBreaks,
  PREVIEW_CARDS_PER_COHORT,
} from '../services/DraftKitService';
import { clearDashboardIndexCache } from '../services/PlayerDashboardService';
import { createChain, createMockSupabase } from './helpers';

// ── Fixture ──────────────────────────────────────────────────────────
//
// Six players: three forwards, two defencemen, one goalie. GAR/60 is set so
// the defencemen sit BELOW every forward. Pooled, the top defenceman is
// mid-pack; within his own cohort he is the best there is. Any regression
// that pools the cohorts changes his percentile from 100 to something else.

const DIR = [
  { player_id: 1, full_name: 'Forward One', position_code: 'C', team_abbrev: 'EDM', jersey_number: '97', headshot_url: null, eligible_positions: ['C'] },
  { player_id: 2, full_name: 'Forward Two', position_code: 'LW', team_abbrev: 'SJS', jersey_number: '29', headshot_url: null, eligible_positions: ['LW'] },
  { player_id: 3, full_name: 'Forward Three', position_code: 'RW', team_abbrev: 'TOR', jersey_number: '16', headshot_url: null, eligible_positions: ['RW'] },
  { player_id: 4, full_name: 'Defence One', position_code: 'D', team_abbrev: 'COL', jersey_number: '8', headshot_url: null, eligible_positions: ['D'] },
  { player_id: 5, full_name: 'Defence Two', position_code: 'D', team_abbrev: 'VAN', jersey_number: '43', headshot_url: null, eligible_positions: ['D'] },
  { player_id: 6, full_name: 'Goalie One', position_code: 'G', team_abbrev: 'WPG', jersey_number: '37', headshot_url: null, eligible_positions: ['G'] },
];

function statRow(id: number, over: Record<string, number> = {}) {
  return {
    player_id: id,
    games_played: 80,
    nhl_goals: 30,
    nhl_assists: 40,
    nhl_points: 70,
    nhl_shots_on_goal: 250,
    nhl_hits: 40,
    nhl_blocks: 50,
    nhl_pim: 20,
    nhl_ppp: 20,
    nhl_plus_minus: 5,
    nhl_toi_seconds: 100000,
    x_goals: 25,
    goalie_gp: 0,
    nhl_wins: 0,
    nhl_saves: 0,
    nhl_save_pct: 0,
    nhl_gaa: 0,
    nhl_shutouts: 0,
    nhl_goals_against: 0,
    ...over,
  };
}

const STATS = [
  statRow(1),
  statRow(2),
  statRow(3),
  statRow(4),
  statRow(5),
  statRow(6, { games_played: 60, goalie_gp: 60, nhl_wins: 35, nhl_saves: 1500, nhl_save_pct: 0.921, nhl_goals_against: 130, nhl_shutouts: 5 }),
];

// GAR/60: forwards 1.50 / 1.20 / 0.90, defencemen 0.60 / 0.30.
// Pooled across all five skaters, Defence One is 2nd from the bottom (40th).
// Within D he is the top of two (100th). That gap is the assertion.
function garRow(id: number, total: number) {
  return {
    player_id: id,
    evo_gar_per_60: total * 0.6,
    evd_gar_per_60: total * 0.1,
    ppo_gar_per_60: total * 0.9,
    ppd_gar_per_60: total * 0.3,
    penalty_gar_per_60: total * 0.2,
    total_gar_per_60: total,
    toi_total_minutes: 1200,
  };
}
const GAR = [garRow(1, 1.5), garRow(2, 1.2), garRow(3, 0.9), garRow(4, 0.6), garRow(5, 0.3)];

const TALENT = [
  { player_id: 1, xg_per_60: 1.4, xg_rating: 'Elite', roster_status: null },
  { player_id: 2, xg_per_60: 1.1, xg_rating: 'Elite', roster_status: null },
  { player_id: 3, xg_per_60: 0.9, xg_rating: 'Good', roster_status: null },
  { player_id: 4, xg_per_60: 0.55, xg_rating: 'Below Avg', roster_status: null },
  { player_id: 5, xg_per_60: 0.35, xg_rating: 'Below Avg', roster_status: null },
];

function rosRow(id: number, pts: number) {
  return {
    player_id: id,
    games_remaining: 80,
    total_projected_points: pts,
    avg_points_per_game: pts / 80,
    projected_goals: 30,
    projected_assists: 40,
    projected_sog: 240,
    projected_ppp: 18,
    projected_hits: 40,
    projected_blocks: 60,
    projected_wins_ros: 0,
    projected_saves_ros: 0,
    projected_shutouts_ros: 0,
  };
}
const ROS = [rosRow(1, 900), rosRow(2, 800), rosRow(3, 500), rosRow(4, 700), rosRow(5, 400), rosRow(6, 600)];

const GOALIE_XG = [
  { goalie_id: 6, gsax: 14.2, xg_faced: 160.4, shots_faced: 1800, goals_allowed: 146 },
  // The playoff row for the same goalie. It must not win over the regular
  // season row — fewer shots faced is the discriminator the service uses.
  { goalie_id: 6, gsax: 2.1, xg_faced: 20.5, shots_faced: 220, goals_allowed: 18 },
];

// The directory as of the season being PROJECTED. Forward Two is on COL here.
const CURRENT_DIR = [
  { player_id: 1, team_abbrev: 'EDM' },
  { player_id: 2, team_abbrev: 'COL' },
  { player_id: 3, team_abbrev: 'TOR' },
  { player_id: 4, team_abbrev: 'COL' },
  { player_id: 5, team_abbrev: 'VAN' },
  { player_id: 6, team_abbrev: 'WPG' },
];

// The directory a season earlier. Forward Two was on SJS, so he moved. Note
// that DIR above (what the dashboard index reads) also says SJS: the dashboard
// is keyed to the METRICS season, which is why the card must not take its club
// from there.
const PRIOR_DIR = [
  { player_id: 1, team_abbrev: 'EDM' },
  { player_id: 2, team_abbrev: 'SJS' },
  { player_id: 3, team_abbrev: 'TOR' },
  { player_id: 4, team_abbrev: 'COL' },
  { player_id: 5, team_abbrev: 'VAN' },
  { player_id: 6, team_abbrev: 'WPG' },
];

const BLURBS = [
  {
    id: 'b1',
    player_id: 1,
    season: 2026,
    kind: 'player',
    title: 'A title',
    body: 'A body',
    author_name: 'An author',
    author_role: 'Citrus',
    source_name: null,
    source_url: null,
    published_at: '2026-09-01T00:00:00Z',
  },
];

/**
 * player_directory is read three times, and the fake answers in call order
 * because that order is deterministic:
 *   1. PlayerDashboardService, keyed to the metrics season (DIR).
 *   2. DraftKitService, keyed to the projection season (CURRENT_DIR).
 *   3. DraftKitService, keyed to the season before that (PRIOR_DIR).
 * Steps 2 and 3 are array elements of one Promise.all, which evaluates left to
 * right, so the sequence holds.
 */
function mockTables(entitlements: unknown[]) {
  const dirCalls = { n: 0 };
  const supabase = createMockSupabase();
  supabase.from = vi.fn((table: string) => {
    switch (table) {
      case 'player_directory': {
        dirCalls.n += 1;
        const rows = dirCalls.n === 1 ? DIR : dirCalls.n === 2 ? CURRENT_DIR : PRIOR_DIR;
        return createChain({ data: rows, error: null });
      }
      case 'player_season_stats':
        return createChain({ data: STATS, error: null });
      case 'player_gar_components':
        return createChain({ data: GAR, error: null });
      case 'player_talent_metrics':
        return createChain({ data: TALENT, error: null });
      case 'player_ros_projections':
        return createChain({ data: ROS, error: null });
      case 'goalie_xg_season':
        return createChain({ data: GOALIE_XG, error: null });
      case 'draft_kit_entitlements':
        return createChain({ data: entitlements, error: null });
      case 'draft_kit_blurbs':
        return createChain({ data: BLURBS, error: null });
      default:
        return createChain({ data: [], error: null });
    }
  });
  return supabase;
}

const ENTITLED = [{ tier: 'kit', expires_at: null, granted_at: '2026-08-01T00:00:00Z' }];

beforeEach(() => {
  clearDashboardIndexCache();
});

// ── Pure helpers ─────────────────────────────────────────────────────

describe('cohortOf', () => {
  it('splits F / D / G and folds every forward code into F', () => {
    expect(cohortOf('C')).toBe('F');
    expect(cohortOf('LW')).toBe('F');
    expect(cohortOf('RW')).toBe('F');
    // Legacy single-letter rows still present in the 2025 directory.
    expect(cohortOf('L')).toBe('F');
    expect(cohortOf('R')).toBe('F');
    expect(cohortOf('D')).toBe('D');
    expect(cohortOf('G')).toBe('G');
  });

  it('trusts the is_goalie flag over an odd position code', () => {
    expect(cohortOf('C', true)).toBe('G');
  });

  it('treats a missing position as a forward rather than throwing', () => {
    expect(cohortOf(null)).toBe('F');
    expect(cohortOf(undefined)).toBe('F');
  });
});

describe('percentileIn', () => {
  it('is the share of the pool at or below the value', () => {
    expect(percentileIn([1, 2, 3, 4], 4)).toBe(100);
    expect(percentileIn([1, 2, 3, 4], 2)).toBe(50);
    expect(percentileIn([1, 2, 3, 4], 0)).toBe(0);
  });

  it('returns 0 for an empty pool instead of dividing by zero', () => {
    expect(percentileIn([], 5)).toBe(0);
  });
});

describe('tierBreaks', () => {
  it('breaks at the largest gaps between neighbours', () => {
    // Gaps: 1, 10, 1, 20 -> the two biggest are at index 4 and index 2.
    expect(tierBreaks([100, 99, 89, 88, 68], 3)).toEqual([2, 4]);
  });

  it('cannot ask for more breaks than there are gaps', () => {
    expect(tierBreaks([10, 5], 8)).toEqual([1]);
    expect(tierBreaks([10], 8)).toEqual([]);
  });
});

describe('tierAtLeast', () => {
  it('orders free < kit < suite', () => {
    expect(tierAtLeast('free', 'kit')).toBe(false);
    expect(tierAtLeast('kit', 'kit')).toBe(true);
    expect(tierAtLeast('suite', 'kit')).toBe(true);
    expect(tierAtLeast('kit', 'suite')).toBe(false);
  });
});

// ── The cohort rule ──────────────────────────────────────────────────

describe('DraftKitService.getBoard — percentiles stay inside the position cohort', () => {
  it('ranks the top defenceman against defencemen, not against forwards', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board, error } = await service.getBoard();
    expect(error).toBeNull();

    const d1 = board!.cards.find((c) => c.playerId === 4)!;
    expect(d1.cohort).toBe('D');

    const gar = d1.metrics.find((m) => m.key === 'gar60')!;
    // Best of the two defencemen -> 100th among D.
    expect(gar.percentile).toBe(100);
    // Pooled across all five skaters he would be 40th. If this ever equals 40
    // the cohorts have been merged.
    expect(gar.percentile).not.toBe(40);
  });

  it('gives the weakest forward a forward-relative percentile above the defencemen', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();

    const f3 = board!.cards.find((c) => c.playerId === 3)!;
    const gar = f3.metrics.find((m) => m.key === 'gar60')!;
    // Lowest of three forwards -> 33rd among F. Pooled he would be 60th.
    expect(f3.cohort).toBe('F');
    expect(gar.percentile).toBe(33);
  });

  it('ranks the penalty-kill component inside cohort too', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    const d1 = board!.cards.find((c) => c.playerId === 4)!;
    const ppd = d1.metrics.find((m) => m.key === 'ppd')!;
    expect(ppd.source).toBe('player_gar_components.ppd_gar_per_60');
    // Top of two defencemen. Pooled across five skaters he would be 40th.
    expect(ppd.percentile).toBe(100);
  });

  it('reports the cohort sizes the percentiles were taken against', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    expect(board!.cohortSizes).toEqual({ F: 3, D: 2, G: 1 });
  });

  it('ranks a defenceman first in his own cohort even when forwards project higher', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    const d1 = board!.cards.find((c) => c.playerId === 4)!;
    // 700 projected points is 3rd overall but 1st among defencemen.
    expect(d1.cohortRank).toBe(1);
    expect(d1.valuePercentile).toBe(100);
  });
});

describe('DraftKitService.getBoard — goalies get their own metric set', () => {
  it('builds GSAx-led metrics and no skater components', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    const g = board!.cards.find((c) => c.playerId === 6)!;

    expect(g.cohort).toBe('G');
    const keys = g.metrics.map((m) => m.key);
    expect(keys).toContain('gsax');
    expect(keys).not.toContain('evo');
    expect(keys).not.toContain('gar60');
  });

  it('takes the regular-season goalie row, not the playoff one', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    const g = board!.cards.find((c) => c.playerId === 6)!;
    expect(g.metrics.find((m) => m.key === 'gsax')!.value).toBe(14.2);
  });

  it('names a real source column for every metric it renders', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    for (const card of board!.cards) {
      for (const m of card.metrics) {
        expect(m.source).toMatch(/^[a-z_]+\./);
      }
    }
  });
});

// ── Roster changes ───────────────────────────────────────────────────

describe('DraftKitService.getBoard — roster changes', () => {
  it('derives a club change by comparing the two directory seasons', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();

    expect(board!.rosterChanges).toHaveLength(1);
    expect(board!.rosterChanges[0]).toMatchObject({
      playerId: 2,
      fromTeam: 'SJS',
      toTeam: 'COL',
    });
  });

  it('takes the card club from the projection season, not the metrics season', async () => {
    // The regression this pins: reading the club from the dashboard index
    // (metrics season) makes a kit for the upcoming season show last season's
    // team, and makes every move invisible because both sides of the
    // comparison are the same row.
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    const moved = board!.cards.find((c) => c.playerId === 2)!;
    expect(moved.team).toBe('COL');
    expect(moved.previousTeam).toBe('SJS');
  });

  it('leaves previousTeam null for a player who stayed put', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();
    expect(board!.cards.find((c) => c.playerId === 1)!.previousTeam).toBeNull();
  });
});

// ── The gate ─────────────────────────────────────────────────────────

describe('DraftKitService — the paywall is a gate, not a decoration', () => {
  it('withholds the paid numbers from an unentitled caller', async () => {
    const service = new DraftKitService(mockTables([]));
    const { board } = await service.getBoard();

    expect(board!.tier).toBe('free');
    expect(board!.locked).toBe(true);

    // The point of the test: nothing paid is present to un-hide.
    for (const card of board!.cards) {
      expect(card.metrics).toEqual([]);
      expect(card.projectedFantasyPoints).toBeNull();
      expect(card.projectedFantasyPpg).toBeNull();
      expect(card.valuePercentile).toBeNull();
    }
    expect(board!.rosterChanges).toEqual([]);
  });

  it('caps the preview at PREVIEW_CARDS_PER_COHORT per cohort but still says what is behind the gate', async () => {
    const service = new DraftKitService(mockTables([]));
    const { board } = await service.getBoard();

    for (const cohort of ['F', 'D', 'G'] as const) {
      const n = board!.cards.filter((c) => c.cohort === cohort).length;
      expect(n).toBeLessThanOrEqual(PREVIEW_CARDS_PER_COHORT);
    }
    expect(board!.totalCards).toBe(6);
    expect(board!.totalRosterChanges).toBe(1);
  });

  it('serves the full board to an entitled caller', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const { board } = await service.getBoard();

    expect(board!.tier).toBe('kit');
    expect(board!.locked).toBe(false);
    expect(board!.cards).toHaveLength(6);
    expect(board!.cards.every((c) => c.cohort === 'G' || c.metrics.length > 0)).toBe(true);
  });

  it('ignores an entitlement that has already expired', async () => {
    const service = new DraftKitService(
      mockTables([{ tier: 'suite', expires_at: '2020-01-01T00:00:00Z', granted_at: '2019-01-01T00:00:00Z' }]),
    );
    expect(await service.getTier()).toBe('free');
  });

  it('takes the highest live tier when a user holds more than one', async () => {
    const service = new DraftKitService(
      mockTables([
        { tier: 'kit', expires_at: null, granted_at: '2026-01-01T00:00:00Z' },
        { tier: 'suite', expires_at: null, granted_at: '2026-02-01T00:00:00Z' },
      ]),
    );
    expect(await service.getTier()).toBe('suite');
  });

  it('fails closed when the entitlement read errors', async () => {
    const supabase = createMockSupabase();
    supabase.from = vi.fn(() => createChain({ data: null, error: { message: 'boom' } }));
    const service = new DraftKitService(supabase);
    expect(await service.getTier()).toBe('free');
  });
});

// ── Blurbs ───────────────────────────────────────────────────────────

describe('DraftKitService.getBlurbs', () => {
  it('maps the authored columns onto the wire shape, attribution included', async () => {
    const service = new DraftKitService(mockTables(ENTITLED));
    const blurbs = await service.getBlurbs(2026, 'kit');
    expect(blurbs).toHaveLength(1);
    expect(blurbs[0]).toMatchObject({
      id: 'b1',
      authorName: 'An author',
      authorRole: 'Citrus',
      sourceName: null,
      sourceUrl: null,
    });
  });

  it('returns an empty list rather than failing the section when the read errors', async () => {
    const supabase = createMockSupabase();
    supabase.from = vi.fn(() => createChain({ data: null, error: { message: 'boom' } }));
    const service = new DraftKitService(supabase);
    expect(await service.getBlurbs(2026, 'suite')).toEqual([]);
  });
});
