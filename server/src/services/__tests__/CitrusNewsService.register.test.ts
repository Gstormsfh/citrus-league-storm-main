// Citrus News register conformance (2026-09-02 voice pass).
//
// The detectors in CitrusNewsService publish prose under Citrus's own byline,
// on player cards, in the slot Sleeper fills with Rotowire copy. That makes
// them the product's writing, and the founder's copy brief applies to them the
// same way it applies to a toast:
//
//   * no em dash, ever;
//   * none of the stock AI phrasebook;
//   * the Citrus source named wherever the sentence states a Citrus number;
//   * no projection-accuracy claim, because there is no benchmark in this
//     repo that could support one.
//
// `CitrusNewsService.test.ts` next door pins WHAT each detector says (its
// thresholds, its numbers, its dedupe keys). This file pins HOW it says it,
// across every detector at once, so a new detector cannot ship prose that
// fails the brief just because nobody remembered the brief.
//
// The register rules are duplicated here rather than imported from
// `apps/web/src/__tests__/aiVoiceGuard.test.ts`: the two suites are separate
// vitest projects with no shared module path, and a copied regex that drifts
// is a smaller problem than a cross-workspace import that breaks the server
// build. The lists are short and both files name the other.

import { describe, it, expect } from 'vitest';
import { DETECTORS, type Detector, type GeneratedNote } from '../CitrusNewsService';

// ── Register rules ───────────────────────────────────────────────────

const EM_DASH = /—/;

const BANNED_PHRASES: Array<[string, RegExp]> = [
  ["it's not just X, it's Y", /\b(?:it'?s|this is|that'?s|we'?re)\s+not\s+(?:just|only)\b/i],
  ["let's dive in", /\b(?:let'?s\s+)?dive\s+in\b/i],
  ["in today's fast-paced world", /\bfast[- ]paced\b/i],
  ['game-changer', /\bgame[-\s]?chang(?:er|ers|ing)\b/i],
  ['unlock', /\bunlock(?:s|ed|ing)?\b/i],
  ['leverage (as a verb)', /\bleverag(?:e|es|ed|ing)\b/i],
  ['delve', /\bdelv(?:e|es|ed|ing)\b/i],
  ['tapestry', /\btapestry\b/i],
  ['landscape (as metaphor)', /\blandscape\b/i],
  ['testament to', /\btestament\s+to\b/i],
  ['navigate the complexities', /\bnavigat\w*\s+the\s+complexit/i],
];

const ACCURACY_CLAIMS: Array<[string, RegExp]> = [
  ['most/wildly accurate', /\b(?:most|wildly|insanely|scary|freakishly)\s+accurate\b/i],
  ['a numeric accuracy figure', /\d\s*%\s*accura|accuracy\s*[:=]?\s*\d/i],
  ['beats a named competitor', /\bbeat(?:s|ing)?\s+(?:espn|yahoo|sleeper|fantrax)\b/i],
];

/**
 * Which Citrus source each detector must name.
 *
 * A detector that states a MODELLED number has to say whose model produced
 * it. The three event detectors are absent on purpose: a hat trick, a shutout
 * and a point streak are counting stats off the box score, so naming a model
 * beside them would be the opposite of honest.
 */
const REQUIRED_SOURCE: Record<string, RegExp> = {
  'bounce-back': /Citrus xG v3/,
  'regression-risk': /Citrus xG/,
  'usage-surge': /Citrus season file/,
  'goalie-workload': /appeared in \d+ games/,
  'season-outlook': /Citrus ROS projection/,
};

function prose(n: GeneratedNote): string {
  return [n.headline, n.body, n.analysis ?? ''].join('\n');
}

// ── Fake PostgREST, same shape as CitrusNewsService.test.ts ──────────

function makeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        gte: (col: string, val: unknown) => {
          filters.push((r) => {
            const a = r[col];
            if (typeof val === 'string' && Number.isNaN(Number(val))) return String(a) >= val;
            return Number(a) >= Number(val);
          });
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        range: async (from: number, to: number) => {
          const all = ((tables[table] || []) as Array<Record<string, unknown>>).filter((r) =>
            filters.every((f) => f(r)),
          );
          return { data: all.slice(from, to + 1), error: null };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const OFFSEASON = new Date(2026, 7, 25);
const IN_SEASON = new Date(2026, 0, 11);

const dir = (id: number, name = 'Player Number0') => ({
  season: 2025,
  player_id: id,
  full_name: name,
  team_abbrev: 'TOR',
  position_code: 'C',
});

const skater = (over: Record<string, unknown> = {}) => ({
  season: 2025,
  is_goalie: false,
  player_id: 1000,
  games_played: 80,
  goals: 10,
  points: 40,
  x_goals: 25,
  icetime_seconds: 80 * 20 * 60,
  ...over,
});

const game = (over: Record<string, unknown> = {}) => ({
  season: 2025,
  is_goalie: false,
  player_id: 1000,
  game_id: 501,
  game_date: '2026-01-10',
  team_abbrev: 'TOR',
  points: 3,
  goals: 1,
  primary_assists: 1,
  secondary_assists: 1,
  shots_on_goal: 5,
  icetime_seconds: 20 * 60,
  saves: 0,
  shots_faced: 0,
  goals_against: 0,
  shutouts: 0,
  wins: 0,
  ...over,
});

/**
 * One dataset per detector, chosen to make that detector fire. Every detector
 * in DETECTORS must appear here: the completeness test below fails when a new
 * one is added without a fixture, which is what stops this file quietly
 * covering seven of eight detectors forever.
 */
const FIXTURES: Record<string, { tables: Record<string, unknown[]>; now: Date }> = {
  'bounce-back': {
    tables: { player_directory: [dir(1000)], player_season_stats: [skater()] },
    now: OFFSEASON,
  },
  'regression-risk': {
    tables: {
      player_directory: [dir(1000)],
      player_season_stats: [skater({ goals: 40, points: 70, x_goals: 25 })],
    },
    now: OFFSEASON,
  },
  'usage-surge': {
    tables: {
      player_directory: [dir(1000)],
      player_season_stats: [
        skater({ icetime_seconds: 80 * 20 * 60 }),
        skater({ season: 2024, icetime_seconds: 80 * 17 * 60 }),
      ],
    },
    now: OFFSEASON,
  },
  'goalie-workload': {
    tables: {
      player_directory: [dir(1000)],
      player_season_stats: [
        {
          season: 2025,
          is_goalie: true,
          player_id: 1000,
          goalie_gp: 58,
          save_pct: 0.918,
          wins: 34,
          shutouts: 4,
          goals_against: 130,
        },
      ],
    },
    now: OFFSEASON,
  },
  'season-outlook': {
    tables: {
      player_ros_projections: [
        {
          season: 2026,
          player_id: 1000,
          player_name: 'Player Number0',
          team_abbrev: 'TOR',
          position: 'C',
          is_goalie: false,
          games_remaining: 78,
          total_projected_points: 360,
          projected_goals: 42,
          projected_assists: 55,
          projected_sog: 260,
          projected_hits: 120,
          projected_blocks: 90,
          projected_ppp: 32,
          avg_points_per_game: 4.6,
        },
        {
          season: 2026,
          player_id: 1001,
          player_name: 'Player Number1',
          team_abbrev: 'TOR',
          position: 'G',
          is_goalie: true,
          games_remaining: 58,
          total_projected_points: 300,
          avg_points_per_game: 5.1,
          projected_wins_ros: 34,
          projected_saves_ros: 1400,
          projected_shutouts_ros: 4,
        },
        // One row per tier, so every verdict string in the decision table is
        // exercised rather than only the top one.
        ...[4.2, 3.4, 2.7, 1.9].map((rate, i) => ({
          season: 2026,
          player_id: 1010 + i,
          player_name: `Player Tier${i}`,
          team_abbrev: 'TOR',
          position: 'C',
          is_goalie: false,
          games_remaining: 78,
          total_projected_points: Math.round(rate * 78),
          projected_goals: 20,
          projected_assists: 30,
          projected_sog: 150,
          projected_hits: 40,
          projected_blocks: 40,
          projected_ppp: 10,
          avg_points_per_game: rate,
        })),
        ...[52, 40, 24].map((gp, i) => ({
          season: 2026,
          player_id: 1020 + i,
          player_name: `Goalie Tier${i}`,
          team_abbrev: 'TOR',
          position: 'G',
          is_goalie: true,
          games_remaining: gp,
          total_projected_points: 200,
          avg_points_per_game: 4,
          projected_wins_ros: 20,
          projected_saves_ros: 900,
          projected_shutouts_ros: 2,
        })),
      ],
    },
    now: OFFSEASON,
  },
  'big-game': {
    tables: { player_directory: [dir(1000)], player_game_stats: [game()] },
    now: IN_SEASON,
  },
  'goalie-gem': {
    tables: {
      player_directory: [dir(1000)],
      player_game_stats: [
        game({ is_goalie: true, points: 0, goals: 0, primary_assists: 0, secondary_assists: 0, shutouts: 1, saves: 28, shots_faced: 28, wins: 1 }),
        game({ game_id: 502, game_date: '2026-01-09', is_goalie: true, points: 0, goals: 0, primary_assists: 0, secondary_assists: 0, saves: 38, shots_faced: 40, goals_against: 2, wins: 1 }),
      ],
    },
    now: IN_SEASON,
  },
  'point-streak': {
    tables: {
      player_directory: [dir(1000)],
      player_game_stats: Array.from({ length: 5 }, (_, i) =>
        game({
          game_id: 600 + i,
          game_date: `2026-01-${String(10 - i).padStart(2, '0')}`,
          points: 1,
          goals: 1,
          primary_assists: 0,
          secondary_assists: 0,
        }),
      ),
    },
    now: IN_SEASON,
  },
};

async function notesFor(detector: Detector): Promise<GeneratedNote[]> {
  const fixture = FIXTURES[detector.kind];
  const season = detector.kind === 'season-outlook' ? 2026 : 2025;
  return detector.run(makeSupabase(fixture.tables), season, fixture.now);
}

// ── The tests ────────────────────────────────────────────────────────

describe('Citrus News register conformance', () => {
  it('every detector has a fixture here, so none escapes the register rules', () => {
    const missing = DETECTORS.map((d) => d.kind).filter((k) => !(k in FIXTURES));
    expect(missing, `add a fixture for: ${missing.join(', ')}`).toEqual([]);
  });

  for (const detector of DETECTORS) {
    describe(detector.kind, () => {
      it('produces at least one note from its fixture', async () => {
        // A fixture that stopped firing would turn every rule below into a
        // vacuous pass over an empty array.
        expect((await notesFor(detector)).length).toBeGreaterThan(0);
      });

      it('never writes an em dash', async () => {
        for (const n of await notesFor(detector)) {
          expect(EM_DASH.test(prose(n)), `em dash in ${detector.kind}:\n${prose(n)}`).toBe(false);
        }
      });

      it('never writes a phrase from the AI phrasebook', async () => {
        for (const n of await notesFor(detector)) {
          const text = prose(n);
          for (const [name, re] of BANNED_PHRASES) {
            expect(re.test(text), `"${name}" in ${detector.kind}:\n${text}`).toBe(false);
          }
        }
      });

      it('never claims projection accuracy', async () => {
        // Standing founder instruction: no accuracy claims without data, and
        // there is no benchmark in this repo that could supply the data.
        for (const n of await notesFor(detector)) {
          const text = prose(n);
          for (const [name, re] of ACCURACY_CLAIMS) {
            expect(re.test(text), `"${name}" in ${detector.kind}:\n${text}`).toBe(false);
          }
        }
      });

      it('never overstates the pass-context coverage', async () => {
        // 10,047 of 2025's 118,975 scored shots carry those features, about
        // 8%. Any sentence pairing them with "every shot" is false.
        for (const n of await notesFor(detector)) {
          expect(prose(n)).not.toMatch(/\b(?:every|all)\s+shots?\b[^.!?]{0,60}\b(?:pass[- ]context|moat|proprietary)\b/i);
        }
      });

      const source = REQUIRED_SOURCE[detector.kind];
      if (source) {
        it('names where its numbers came from', async () => {
          for (const n of await notesFor(detector)) {
            expect(prose(n), `${detector.kind} states a number without naming its source`).toMatch(source);
          }
        });
      }

      it('states a fantasy implication rather than only a statistic', async () => {
        // A beat writer's note ends on what to DO. Every detector's analysis
        // field exists for exactly that, so it must be present and it must
        // be a sentence rather than a stub.
        for (const n of await notesFor(detector)) {
          expect(n.analysis, `${detector.kind} published no analysis`).toBeTruthy();
          expect(n.analysis!.length).toBeGreaterThan(60);
          expect(n.analysis).not.toMatch(/NaN|undefined|Infinity/);
        }
      });
    });
  }
});
