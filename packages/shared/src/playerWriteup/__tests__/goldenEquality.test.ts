import { describe, it, expect } from 'vitest';
import type { DashboardIndexEntry, XgHistoryPoint } from '../../types/playerDashboard';
import { DEFAULT_SCORING, ScoringCalculator } from '../../utils/scoring';
import { projectionSettings } from '../../leagueProjection';
import {
  generatePlayerWriteup,
  type CareerSummary,
  type WriteupExtras,
  type WriteupPlayer,
} from '../index';
import {
  buildWriteupFromSources,
  writeupExtrasFromSources,
  writeupPlayerFromIndex,
  type WriteupSources,
} from '../fromIndex';

/**
 * GOLDEN EQUALITY: THE PROOF THAT MOVING THE WRITEUP SERVER-SIDE CHANGED
 * NOBODY'S CARD (2026-09-11).
 *
 * The port has two halves and only one of them is mechanical. Moving 814
 * lines of engine into `@citrus/shared` is covered by
 * `apps/web/src/utils/__tests__/playerWriteup.test.ts`, which still runs
 * against the same exported functions through the web shim and did not
 * change by a character.
 *
 * The half that could go wrong is the ASSEMBLY: the browser built
 * `WriteupPlayer` and `WriteupExtras` out of six client sources, and the
 * server now builds them out of database rows. A single mismapped column --
 * `sog` read as shots on goal when the engine wants total shots, `blocks`
 * transposed with `hits` -- produces a card that is confidently, quietly
 * wrong, which is the exact failure this engine exists to prevent.
 *
 * So every fixture below declares the client's inputs AS LITERALS, written
 * out by hand the way `PlayerStatsModal` builds them, and asserts three
 * things against them:
 *
 *   1. `writeupPlayerFromIndex` maps the row onto that player exactly;
 *   2. `writeupExtrasFromSources` derives those extras exactly;
 *   3. the finished writeup is deep-equal to the one the browser's own call
 *      would have produced.
 *
 * A literal is not derived from the implementation, so (3) cannot pass by
 * both sides making the same mistake.
 *
 * THE FIXTURES, AND WHY EACH ONE. A skater with a long career (every extra
 * sentence at once: seasons on record, trophies, the draft line, the cohort
 * read, the projection); a goalie (a different engine branch and a
 * different cohort, with no xG or GAR column in the payload at all); a
 * rookie with no NHL history (nothing to say, said honestly); a player on
 * injured reserve (availability outranks the stat line and rewrites the
 * card note); and one under the eight-game floor, where `hasEnoughData` is
 * false and every extra sentence must be suppressed rather than attached to
 * a two-game sample.
 */

// A day in the 2026-27 preseason: before the opener, so the projection is
// framed as a season rather than as what is left of one. Pinned so this
// suite reads the same in March as it does today.
const NOW = new Date('2026-09-11T12:00:00-06:00');

const ROW: DashboardIndexEntry = {
  id: 0,
  actuals_season: 2026,
  projection_season: 2026,
  name: '',
  team: 'EDM',
  position: 'C',
  jersey: null,
  headshot_url: null,
  is_goalie: false,
  roster_status: null,
  gp: 0,
  goals: 0,
  assists: 0,
  points: 0,
  sog: 0,
  hits: 0,
  blocks: 0,
  ppp: 0,
  plus_minus: 0,
  x_goals: 0,
  pim: 0,
  shp: 0,
  toi_seconds: 0,
  wins: 0,
  losses: 0,
  ot_losses: 0,
  saves: 0,
  save_pct: 0,
  gaa: 0,
  shutouts: 0,
  goals_against: 0,
  xg_per_60: null,
  xg_rating: null,
  gar_per_60: null,
  gar_evo: null,
  gar_evd: null,
  gar_ppo: null,
  gar_ppd: null,
  gar_pen: null,
  toi_total_minutes: null,
  avg_toi_per_game: null,
  vopa_score: null,
  gsax_raw: null,
  gsax_regressed: null,
  gsax_shots_faced: null,
  gsax_xga: null,
  gsax_ga: null,
  proj_gp: null,
  proj_fantasy_points: null,
  proj_fantasy_ppg: null,
  proj_goals: null,
  proj_assists: null,
  proj_sog: null,
  proj_ppp: null,
  proj_blocks: null,
  proj_hits: null,
  proj_pim: null,
  proj_shp: null,
  proj_goals_against: null,
  proj_wins: null,
  proj_saves: null,
  proj_shutouts: null,
  as_of: null,
};

const row = (o: Partial<DashboardIndexEntry>): DashboardIndexEntry => ({ ...ROW, ...o });

/**
 * FILLER FOR THE COHORT, not decoration. A percentile is a claim about a
 * comparison set, and `qualifiedCohort` admits only players with at least
 * ten games, so a cohort built from the subject alone would place him at
 * the 100th percentile of a league of one. Twenty forwards on a ladder of
 * xG/60 and GAR/60 give the fixtures a distribution with a real shape, and
 * the same twenty are handed to both sides of every assertion.
 */
const FILLER: DashboardIndexEntry[] = Array.from({ length: 20 }, (_, i) =>
  row({
    id: 5000 + i,
    name: `Filler ${i}`,
    position: 'C',
    gp: 60,
    // Written as exact hundredths. `0.5 + i * 0.05` is 1.4500000000000002 at
    // the top of the ladder, which silently puts the subject one rung below
    // his own cohort's ceiling and turns a 100th percentile into a 96th.
    xg_per_60: (50 + i * 5) / 100,
    gar_per_60: (-20 + i * 6) / 100,
    proj_gp: 82,
    proj_goals: 10 + i,
    proj_assists: 15 + i,
    proj_sog: 150,
    proj_ppp: 10,
    proj_blocks: 40,
    proj_hits: 40,
    proj_pim: 20,
    proj_shp: 1,
  }),
);

const GOALIE_FILLER: DashboardIndexEntry[] = Array.from({ length: 12 }, (_, i) =>
  row({
    id: 6000 + i,
    name: `Keeper ${i}`,
    position: 'G',
    is_goalie: true,
    gp: 40,
    wins: 15 + i,
    save_pct: 0.895 + i * 0.003,
    gaa: 3.2 - i * 0.06,
    shutouts: i % 4,
    proj_gp: 55,
    proj_wins: 25,
    proj_saves: 1400,
    proj_shutouts: 3,
    proj_goals_against: 130,
  }),
);

/**
 * One league's own weights. Deliberately NOT the defaults for goals and
 * assists, so a fixture that accidentally scored league-neutrally would
 * show up as a different number rather than as the same one.
 */
const LEAGUE_SCORING = {
  skater: { ...DEFAULT_SCORING.skater, goals: 7, assists: 5 },
  goalie: { ...DEFAULT_SCORING.goalie },
};

/**
 * What the league's scorer makes of a stat line.
 *
 * The fixtures below hand this the `proj_*` columns TRANSCRIBED BY HAND off
 * the row, under the engine's own stat names. That is the assertion that
 * matters here: not what the weights are, which `ScoringCalculator` owns
 * and `scoringDefaults.json` pins, but that the assembly fed the scorer the
 * right column for each category. Transposing blocks and hits, or reading
 * `proj_sog` as shots against, changes this number and fails the fixture.
 */
const scored = (scoring: unknown, stats: Record<string, number>, goalie: boolean) =>
  new ScoringCalculator(projectionSettings(scoring)).calculatePoints(stats, goalie);

const SKATER_PROJECTION = { goals: 45, assists: 90, ppp: 50, sog: 290, blocks: 25, hits: 40, pim: 24, shp: 2 };
const GOALIE_PROJECTION = { wins: 36, saves: 1500, shutouts: 5, goals_against: 125 };

interface Fixture {
  label: string;
  sources: WriteupSources;
  /** What `PlayerStatsModal` would have handed the engine, written by hand. */
  player: WriteupPlayer;
  extras: WriteupExtras;
}

const MCDAVID_CAREER: CareerSummary = {
  gp: 700,
  goals: 340,
  assists: 700,
  points: 1040,
  seasons: 10,
  first_season: 2015,
  draft: { year: 2015, round: 1, overall: 1, team: 'EDM' },
  awards: [
    { name: 'Hart Memorial Trophy', count: 3 },
    { name: 'Art Ross Trophy', count: 5 },
  ],
};

const MCDAVID_SEASONS: XgHistoryPoint[] = [
  { season: 2021, game_type: 'regular', shots: 250, sog: 250, goals: 44, xg: 38, finishing: 6, teams: 1 },
  { season: 2022, game_type: 'regular', shots: 260, sog: 260, goals: 64, xg: 46, finishing: 18, teams: 1 },
  { season: 2023, game_type: 'regular', shots: 240, sog: 240, goals: 32, xg: 35, finishing: -3, teams: 1 },
  // A playoff row on the same season. The engine counts REGULAR seasons on
  // record; counting this one would invent a fourth.
  { season: 2023, game_type: 'playoff', shots: 60, sog: 60, goals: 8, xg: 7, finishing: 1, teams: 1 },
];

const mcdavidRow = row({
  id: 8478402,
  name: 'Connor McTest',
  position: 'C',
  gp: 76,
  goals: 44,
  assists: 89,
  points: 133,
  sog: 280,
  hits: 40,
  blocks: 25,
  ppp: 48,
  plus_minus: 28,
  x_goals: 36.5,
  toi_seconds: 76 * 1290, // 21:30 a night
  xg_per_60: 1.45,
  gar_per_60: 1.1,
  proj_gp: 80,
  proj_goals: 45,
  proj_assists: 90,
  proj_sog: 290,
  proj_ppp: 50,
  proj_blocks: 25,
  proj_hits: 40,
  proj_pim: 24,
  proj_shp: 2,
});

const rookieRow = row({
  id: 8484000,
  name: 'Rook Ledger',
  position: 'LW',
  gp: 22,
  goals: 5,
  assists: 7,
  points: 12,
  sog: 44,
  hits: 18,
  blocks: 9,
  ppp: 2,
  plus_minus: -3,
  x_goals: 5.4,
  toi_seconds: 22 * 780, // 13:00 a night
  xg_per_60: 0.62,
  gar_per_60: -0.05,
});

const irRow = row({
  ...mcdavidRow,
  id: 8477500,
  name: 'Sidney Bench',
  roster_status: 'LTIR',
});

const thinRow = row({
  id: 8490000,
  name: 'Callup Kidd',
  position: 'RW',
  gp: 3,
  goals: 1,
  assists: 2,
  points: 3,
  sog: 7,
  toi_seconds: 3 * 700,
});

const goalieRow = row({
  id: 8479361,
  name: 'Ilya Testov',
  position: 'G',
  is_goalie: true,
  gp: 52,
  wins: 34,
  losses: 13,
  save_pct: 0.921,
  gaa: 2.28,
  shutouts: 5,
  gsax_regressed: 14.2,
  proj_gp: 58,
  proj_wins: 36,
  proj_saves: 1500,
  proj_shutouts: 5,
  proj_goals_against: 125,
});

const index = [...FILLER, ...GOALIE_FILLER, mcdavidRow, rookieRow, irRow, thinRow, goalieRow];

/**
 * The cohort reads, computed the way the advanced card computes them: the
 * qualified members of the player's own cohort, ranked on xG/60 and GAR/60.
 *
 * Written out as the numbers they actually are rather than recomputed, so
 * the assertion is against an answer and not against the same function
 * under a different name.
 *
 * TWENTY-THREE FORWARDS QUALIFY: the twenty filler rungs, plus McTest (76
 * games), the rookie (22) and the injured skater (76). The three-game
 * call-up is PLACED against that scale but does not join it, which is the
 * whole point of a distribution minimum. The goalies are never pooled with
 * any of them and count 13.
 *
 * McTest tops both ladders at 1.45 xG/60 and 1.10 GAR/60, so both read
 * 100th. The rookie's 0.62 sits at or above four of the 23 xG values (three
 * filler rungs and his own) and his -0.05 at or above four of the GAR
 * values, which the inclusive CDF this app uses everywhere puts at 17th.
 */
const FORWARDS = 23;

const fixtures: Fixture[] = [
  {
    label: 'a skater with a long career',
    sources: {
      entry: mcdavidRow,
      index,
      xgSeasons: MCDAVID_SEASONS,
      career: MCDAVID_CAREER,
      birthdate: '1997-01-13',
      scoring: LEAGUE_SCORING,
      now: NOW,
    },
    player: {
      statsSeason: 2026,
      id: 8478402,
      name: 'Connor McTest',
      position: 'C',
      status: null,
      stats: {
        gamesPlayed: 76,
        goals: 44,
        assists: 89,
        points: 133,
        plusMinus: 28,
        shots: 280,
        blockedShots: 25,
        hits: 40,
        powerPlayPoints: 48,
        toi: '21:30',
        xGoals: 36.5,
        wins: 0,
        losses: 0,
        gaa: 0,
        savePct: 0,
        shutouts: 0,
        goalsSavedAboveExpected: undefined,
      },
    },
    extras: {
      projectionSeason: 2026,
      age: 29,
      goalsBySeason: [
        { season: 2021, goals: 44 },
        { season: 2022, goals: 64 },
        { season: 2023, goals: 32 },
      ],
      xgPercentile: 100,
      garPercentile: 100,
      cohortNoun: 'forwards',
      cohortSize: FORWARDS,
      projFp: scored(LEAGUE_SCORING, SKATER_PROJECTION, false),
      projGp: 80,
      posRank: 'C1',
      projectionLabel: 'for 2026-27',
      career: MCDAVID_CAREER,
    },
  },
  {
    label: 'a goalie',
    sources: {
      entry: goalieRow,
      index,
      xgSeasons: [],
      career: { gp: 400, wins: 220, shutouts: 30, seasons: 8, draft: null },
      birthdate: '1998-05-02',
      scoring: LEAGUE_SCORING,
      now: NOW,
    },
    player: {
      statsSeason: 2026,
      id: 8479361,
      name: 'Ilya Testov',
      position: 'G',
      status: null,
      stats: {
        gamesPlayed: 52,
        goals: 0,
        assists: 0,
        points: 0,
        plusMinus: 0,
        shots: 0,
        blockedShots: 0,
        hits: 0,
        powerPlayPoints: 0,
        toi: undefined,
        xGoals: 0,
        wins: 34,
        losses: 13,
        gaa: 2.28,
        savePct: 0.921,
        shutouts: 5,
        goalsSavedAboveExpected: 14.2,
      },
    },
    extras: {
      projectionSeason: 2026,
      age: 28,
      goalsBySeason: [],
      // No xG/60 and no GAR row exists for a goalie anywhere in this
      // payload, so both scales are empty within cohort G and both reads
      // are null. The cohort is still named and counted, because the
      // goalie card's other sentences use it.
      xgPercentile: null,
      garPercentile: null,
      cohortNoun: 'goalies',
      cohortSize: 13,
      projFp: scored(LEAGUE_SCORING, GOALIE_PROJECTION, true),
      projGp: 58,
      posRank: 'G1',
      projectionLabel: 'for 2026-27',
      career: { gp: 400, wins: 220, shutouts: 30, seasons: 8, draft: null },
    },
  },
  {
    label: 'a rookie with no NHL history',
    sources: {
      entry: rookieRow,
      index,
      xgSeasons: [],
      career: null,
      birthdate: '2005-08-30',
      scoring: null,
      now: NOW,
    },
    player: {
      statsSeason: 2026,
      id: 8484000,
      name: 'Rook Ledger',
      position: 'LW',
      status: null,
      stats: {
        gamesPlayed: 22,
        goals: 5,
        assists: 7,
        points: 12,
        plusMinus: -3,
        shots: 44,
        blockedShots: 9,
        hits: 18,
        powerPlayPoints: 2,
        toi: '13:00',
        xGoals: 5.4,
        wins: 0,
        losses: 0,
        gaa: 0,
        savePct: 0,
        shutouts: 0,
        goalsSavedAboveExpected: undefined,
      },
    },
    extras: {
      projectionSeason: 2026,
      age: 21,
      goalsBySeason: [],
      // Four of the 23 qualified forwards sit at or below his 0.62 xG/60
      // (three filler rungs and himself), and four at or below his -0.05
      // GAR/60. The inclusive CDF the whole app uses puts him at 17th on
      // both.
      xgPercentile: Math.round((100 * 4) / FORWARDS),
      garPercentile: Math.round((100 * 4) / FORWARDS),
      cohortNoun: 'forwards',
      cohortSize: FORWARDS,
      // No league named, so no projection sentence. Not a league-neutral
      // number: a wrong projection is worse than a missing one.
      projFp: null,
      projGp: null,
      posRank: null,
      projectionLabel: 'for 2026-27',
      career: null,
    },
  },
  {
    label: 'a player on injured reserve',
    sources: {
      entry: irRow,
      index,
      xgSeasons: MCDAVID_SEASONS,
      career: MCDAVID_CAREER,
      birthdate: '1997-08-07',
      scoring: LEAGUE_SCORING,
      now: NOW,
    },
    player: {
      statsSeason: 2026,
      id: 8477500,
      name: 'Sidney Bench',
      position: 'C',
      status: 'IR',
      stats: {
        gamesPlayed: 76,
        goals: 44,
        assists: 89,
        points: 133,
        plusMinus: 28,
        shots: 280,
        blockedShots: 25,
        hits: 40,
        powerPlayPoints: 48,
        toi: '21:30',
        xGoals: 36.5,
        wins: 0,
        losses: 0,
        gaa: 0,
        savePct: 0,
        shutouts: 0,
        goalsSavedAboveExpected: undefined,
      },
    },
    extras: {
      projectionSeason: 2026,
      age: 29,
      goalsBySeason: [
        { season: 2021, goals: 44 },
        { season: 2022, goals: 64 },
        { season: 2023, goals: 32 },
      ],
      xgPercentile: 100,
      garPercentile: 100,
      cohortNoun: 'forwards',
      cohortSize: FORWARDS,
      projFp: scored(LEAGUE_SCORING, SKATER_PROJECTION, false),
      projGp: 80,
      posRank: 'C1',
      projectionLabel: 'for 2026-27',
      career: MCDAVID_CAREER,
    },
  },
  {
    label: 'a three-game call-up, below the rate floor',
    sources: {
      entry: thinRow,
      index,
      xgSeasons: [],
      career: null,
      birthdate: '2004-02-19',
      scoring: LEAGUE_SCORING,
      now: NOW,
    },
    player: {
      statsSeason: 2026,
      id: 8490000,
      name: 'Callup Kidd',
      position: 'RW',
      status: null,
      stats: {
        gamesPlayed: 3,
        goals: 1,
        assists: 2,
        points: 3,
        plusMinus: 0,
        shots: 7,
        blockedShots: 0,
        hits: 0,
        powerPlayPoints: 0,
        toi: '11:40',
        xGoals: 0,
        wins: 0,
        losses: 0,
        gaa: 0,
        savePct: 0,
        shutouts: 0,
        goalsSavedAboveExpected: undefined,
      },
    },
    extras: {
      projectionSeason: 2026,
      age: 22,
      goalsBySeason: [],
      // Three games is below `DISTRIBUTION_MIN_GP`, so he is PLACED against
      // the forwards' scale without joining it. He has no xG/60 or GAR row
      // at all, so both reads are null anyway.
      xgPercentile: null,
      garPercentile: null,
      cohortNoun: 'forwards',
      cohortSize: FORWARDS,
      // No `proj_gp` row, so no projection exists to score.
      projFp: null,
      projGp: null,
      posRank: null,
      projectionLabel: 'for 2026-27',
      career: null,
    },
  },
];

// Browser and server now both pass the enabled scoring categories to the shared policy.
for (const f of fixtures) {
  if (f.sources.scoring != null) f.extras.scoringCategories = ['goals', 'assists', 'power_play_points', 'shots', 'blocks', 'wins', 'shutouts', 'saves', 'goals_against'];
}

describe('server-assembled writeup equals the one the browser used to build', () => {
  for (const f of fixtures) {
    describe(f.label, () => {
      it('maps the index row onto the player the client passed', () => {
        expect(writeupPlayerFromIndex(f.sources.entry)).toEqual(f.player);
      });

      it('derives the extras the client assembled', () => {
        expect(writeupExtrasFromSources(f.sources)).toEqual(f.extras);
      });

      it('renders a writeup deep-equal to the browser-rendered one', () => {
        expect(buildWriteupFromSources(f.sources)).toEqual(
          generatePlayerWriteup(f.player, f.extras),
        );
      });
    });
  }

  it('covers the branches the fixtures were chosen for', () => {
    const byLabel = (l: string) => fixtures.find((f) => f.label === l) as Fixture;

    // hasEnoughData false, and every EXTRA sentence suppressed with it.
    // `applyWriteupExtras` returns early on a thin sample, so the age, the
    // cohort read and the projection are all withheld even though the
    // sources carry a league and a birthdate. What is left is the engine's
    // own honest "too early to tell", which is the thing that must be said
    // instead of a number.
    const thin = buildWriteupFromSources(byLabel('a three-game call-up, below the rate floor').sources);
    expect(thin.hasEnoughData).toBe(false);
    expect(thin.analysis).toMatch(/cannot establish a sustainable rate/);
    expect(thin.analysis).not.toMatch(/percentile|Projects to/);
    expect(thin.summary).not.toMatch(/He is 22|Career:/);
    expect(thin.tags).toContainEqual({ label: 'Limited sample', tone: 'neutral' });

    // Availability outranks the stat line, and it takes the card's one line.
    const ir = buildWriteupFromSources(byLabel('a player on injured reserve').sources);
    expect(ir.cardNote).toBe('On injured reserve');
    expect(ir.cardTone).toBe('caution');
    expect(ir.summary.startsWith('Currently on injured reserve.')).toBe(true);

    // The rookie has nothing to say about a career, so nothing is said.
    const rookie = buildWriteupFromSources(byLabel('a rookie with no NHL history').sources);
    expect(rookie.hasEnoughData).toBe(true);
    expect(rookie.summary).not.toMatch(/Career:/);
    expect(rookie.analysis).not.toMatch(/Projects to/);

    // The long career gets the sentences it is owed, by our own numbers.
    const star = buildWriteupFromSources(byLabel('a skater with a long career').sources);
    expect(star.summary).toMatch(/Career: 340 goals and 1,040 points in 700 games over 10 NHL seasons\./);
    expect(star.summary).toMatch(/Drafted 1st overall in 2015 by EDM\./);
    expect(star.analysis).toMatch(/of forwards\./);
    expect(star.analysis).toMatch(/Projects to \d+ fantasy points over 80 games for 2026-27 \(C1\)\./);

    // A goalie is never placed on a skater's scale.
    const goalie = buildWriteupFromSources(byLabel('a goalie').sources);
    expect(goalie.analysis).not.toMatch(/xG\/60|GAR\/60/);
    expect(goalie.analysis).toMatch(/Projects to \d+ fantasy points over 58 starts for 2026-27 \(G1\)\./);
  });
});

describe('the projection sentence is scored with the league that asked for it', () => {
  const base = fixtures[0].sources;

  it('two leagues with different weights get different numbers for one player', () => {
    const cheapGoals = { ...base, scoring: { skater: { ...DEFAULT_SCORING.skater, goals: 2 } } };
    const richGoals = { ...base, scoring: { skater: { ...DEFAULT_SCORING.skater, goals: 12 } } };

    const cheap = writeupExtrasFromSources(cheapGoals).projFp as number;
    const rich = writeupExtrasFromSources(richGoals).projFp as number;

    // 45 projected goals, ten points of weight between the two leagues.
    expect(rich - cheap).toBeCloseTo(45 * 10, 6);
    expect(buildWriteupFromSources(cheapGoals).analysis).not.toBe(
      buildWriteupFromSources(richGoals).analysis,
    );
  });

  it('omits the sentence entirely rather than falling back to league-neutral scoring', () => {
    const noLeague = { ...base, scoring: null };
    expect(writeupExtrasFromSources(noLeague).projFp).toBeNull();
    expect(writeupExtrasFromSources(noLeague).posRank).toBeNull();
    expect(buildWriteupFromSources(noLeague).analysis).not.toMatch(/Projects to/);
  });

  it('scores a category a league has dropped at zero rather than at the default weight', () => {
    // A league that wrote its own document and left hits out of it does not
    // score hits. Defaulting the absent key would hand every banger points
    // the league does not award.
    const noHits = { ...base, scoring: { skater: { goals: 6, assists: 4 } } };
    const withHits = { ...base, scoring: { skater: { goals: 6, assists: 4, hits: 1 } } };
    expect((writeupExtrasFromSources(withHits).projFp as number)
      - (writeupExtrasFromSources(noHits).projFp as number)).toBeCloseTo(40, 6);
    expect(writeupExtrasFromSources(noHits).projFp).toBeCloseTo(45 * 6 + 90 * 4, 6);
  });
});
