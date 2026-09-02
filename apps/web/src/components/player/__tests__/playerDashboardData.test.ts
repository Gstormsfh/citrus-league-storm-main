import { describe, it, expect } from 'vitest';
import {
  GOAL_LINE_X,
  PLACEMENT_TOLERANCE_FT,
  careerSeries,
  deriveGoalieVerdict,
  deriveShotVerdict,
  projectShot,
  ordinal,
  seasonLabel,
  seasonRow,
  shotZone,
  signed,
  summariseShots,
  toRinkEvents,
} from '../playerDashboardData';
import type { DashboardSeasonRow, DashboardShot } from '@/hooks/usePlayerDashboard';

/**
 * THE GEOMETRY IS THE PRODUCT HERE.
 *
 * `RinkHeatmap` takes normalised [0,1] coordinates and this module is the
 * only thing that decides which feet become which dot. A sign error puts a
 * player's whole season on the wrong side of the ice and nothing in the app
 * would notice — the map would still look like a shot map. So the frame is
 * pinned to fixed points (the net, the blue line, the boards) rather than
 * to a screenshot.
 *
 * The frame itself is not invented: `nhl_shot_features` in
 * supabase/schema/production_snapshot_20260813.sql computes
 * `(x_adj > 89) AS f_behind_net` and `abs(y_adj) AS f_yabs`, which pins the
 * goal line at x = 89 and makes y the signed lateral offset in feet.
 */

/** A well-formed row: `distance` computed FROM the coordinates, as prod does. */
function shot(over: Partial<DashboardShot> = {}): DashboardShot {
  const x = over.x ?? 74;
  const y = over.y ?? 0;
  const distance =
    over.distance !== undefined ? over.distance : Math.hypot(GOAL_LINE_X - x, y);
  return {
    game_id: 2025020001,
    event_id: 1,
    game_date: '2025-10-08',
    x,
    y,
    distance,
    angle: 0,
    xg: 0.2,
    is_goal: false,
    shot_type: 'wrist',
    event_type: 'shot-on-goal',
    is_rush: false,
    is_rebound: false,
    is_power_play: false,
    is_shorthanded: false,
    is_empty_net: false,
    strength_state: '5v5',
    // `over` is spread LAST so a test can override anything — including the
    // distance, which is how the placement guard gets exercised.
    ...over,
  };
}

describe('projectShot — feet on the model frame → the rink primitive', () => {
  it('puts a shot ON the goal line at the top of the frame', () => {
    // y = 1 is the goal line: `RinkHeatmap` maps y=1 to cy=8 and the goal
    // line sits at cy=7.
    expect(projectShot(shot({ x: 89, y: 0 }))!.y).toBeCloseTo(1, 5);
  });

  it('puts a shot ON the blue line at the bottom of the frame', () => {
    // 64 ft from the goal line = x 25 = the offensive blue line.
    expect(projectShot(shot({ x: 25, y: 0 }))!.y).toBeCloseTo(0, 5);
  });

  it('puts a centre-ice-lane shot in the middle of the frame', () => {
    expect(projectShot(shot({ x: 70, y: 0 }))!.x).toBeCloseTo(0.5, 5);
  });

  it('maps the lateral sign consistently and symmetrically', () => {
    // +y is 90° counter-clockwise from the attacking direction, which with
    // the net at the top of the frame is the frame's LEFT.
    const left = projectShot(shot({ x: 70, y: 20 }))!;
    const right = projectShot(shot({ x: 70, y: -20 }))!;
    expect(left.x).toBeLessThan(0.5);
    expect(right.x).toBeGreaterThan(0.5);
    expect(left.x + right.x).toBeCloseTo(1, 5);
    expect(left.y).toBeCloseTo(right.y, 5);
  });

  it('puts the boards at the edges of the frame', () => {
    expect(projectShot(shot({ x: 70, y: 42.5 }))!.x).toBeCloseTo(0, 5);
    expect(projectShot(shot({ x: 70, y: -42.5 }))!.x).toBeCloseTo(1, 5);
  });

  it('clamps a wrap-around from behind the net to the goal line, not off the frame', () => {
    const p = projectShot(shot({ x: 95, y: 2 }))!;
    expect(p.y).toBe(1);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(1);
  });

  it('drops a row with no coordinates rather than placing it at the origin', () => {
    expect(projectShot({ x: null, y: 3, distance: 10 })).toBeNull();
    expect(projectShot({ x: 70, y: null, distance: 10 })).toBeNull();
    expect(projectShot({ x: Number.NaN, y: 0, distance: 10 })).toBeNull();
  });

  it('drops a coordinate that is not on a hockey rink', () => {
    expect(projectShot({ x: 70, y: 300, distance: 300 })).toBeNull();
    expect(projectShot({ x: 5000, y: 0, distance: 5000 })).toBeNull();
  });

  // THE GUARD. `distance` is a scalar and therefore frame-independent, so it
  // is an INDEPENDENT check on the placement. A map that is silently wrong
  // is worse than a map that is absent, because it looks authoritative.
  it('drops a shot whose coordinates disagree with its own stored distance', () => {
    const bad = shot({ x: 74, y: 0, distance: 15 + PLACEMENT_TOLERANCE_FT + 5 });
    expect(projectShot(bad)).toBeNull();
  });

  it('admits a disagreement inside the tolerance — stored columns are rounded', () => {
    const ok = shot({ x: 74, y: 0, distance: 15 + PLACEMENT_TOLERANCE_FT - 1 });
    expect(projectShot(ok)).not.toBeNull();
  });

  it('places a shot with no stored distance at all — the guard is a check, not a requirement', () => {
    expect(projectShot({ x: 74, y: 0, distance: null })).not.toBeNull();
  });
});

describe('shotZone — rink dimensions, not taste', () => {
  const zoneOf = (x: number, y: number) => {
    const s = shot({ x, y });
    return shotZone(projectShot(s), s);
  };

  it('classifies each zone by its own geometry', () => {
    expect(zoneOf(78, 2)).toBe('LOW SLOT'); // 11 ft out, between the dots
    expect(zoneOf(64, 6)).toBe('SLOT'); // 25 ft out
    expect(zoneOf(48, 8)).toBe('HIGH SLOT'); // 41 ft out
    expect(zoneOf(30, 4)).toBe('POINT'); // 59 ft out
    expect(zoneOf(67, 20)).toBe('CIRCLES'); // on the dot
    expect(zoneOf(70, 34)).toBe('BOARDS'); // out by the half-wall
  });

  // The reason CIRCLES exists: with the spec's five zones a faceoff-circle
  // shot fell into BOARDS, and the page then said "33% of his attempts come
  // from the boards" about a player shooting from the circles.
  it('does not call a faceoff-circle shot a boards shot', () => {
    expect(zoneOf(67, 20)).not.toBe('BOARDS');
    expect(zoneOf(72, 22)).toBe('CIRCLES');
  });

  it('the point wins over lateral position — a shot from the line is a point shot', () => {
    expect(zoneOf(28, 30)).toBe('POINT');
  });

  it('returns null for an unplaceable shot instead of guessing a zone', () => {
    expect(shotZone(null, shot())).toBeNull();
  });
});

describe('summariseShots', () => {
  const season: DashboardShot[] = [
    ...Array.from({ length: 10 }, () => shot({ x: 77, y: 1, xg: 0.25, is_goal: true })),
    ...Array.from({ length: 6 }, () => shot({ x: 64, y: 5, xg: 0.1, is_rush: true })),
    ...Array.from({ length: 4 }, () => shot({ x: 30, y: 0, xg: 0.02, is_power_play: true, strength_state: '5v4' })),
  ];

  it('counts, shares and per-shot xG all come off the same placed set', () => {
    const s = summariseShots(season);
    expect(s.total).toBe(20);
    expect(s.plotted).toBe(20);
    expect(s.reliable).toBe(true);
    expect(s.goals).toBe(10);
    expect(s.xg).toBeCloseTo(10 * 0.25 + 6 * 0.1 + 4 * 0.02);
    expect(s.rushShots).toBe(6);
    expect(s.powerPlayShots).toBe(4);
    expect(s.evenStrengthShots).toBe(16);

    const low = s.zones.find((z) => z.zone === 'LOW SLOT')!;
    expect(low.attempts).toBe(10);
    expect(low.share).toBeCloseTo(50);
    expect(low.xgPerShot).toBeCloseTo(0.25);
    expect(s.zones.reduce((t, z) => t + z.share, 0)).toBeCloseTo(100);
  });

  it('a zone with no attempts reports null xG per shot, never 0.000', () => {
    const s = summariseShots([shot({ x: 77, y: 1 })]);
    expect(s.zones.find((z) => z.zone === 'POINT')!.xgPerShot).toBeNull();
  });

  // "No shots" and "we could not place the shots" are DIFFERENT facts and
  // the page renders a different sentence for each.
  it('zero shots is reliable — there is simply nothing to draw', () => {
    const s = summariseShots([]);
    expect(s.total).toBe(0);
    expect(s.plotted).toBe(0);
    expect(s.reliable).toBe(true);
  });

  it('mostly-unplaceable shots are reported UNRELIABLE, not drawn thin', () => {
    const broken = Array.from({ length: 10 }, () => shot({ x: 74, y: 0, distance: 90 }));
    const s = summariseShots([...broken, shot({ x: 77, y: 1 })]);
    expect(s.total).toBe(11);
    expect(s.plotted).toBe(1);
    expect(s.reliable).toBe(false);
  });
});

describe('toRinkEvents — the segmented control actually filters', () => {
  const mixed: DashboardShot[] = [
    shot({ event_id: 1, x: 74, y: 0, strength_state: '5v5' }),
    shot({ event_id: 2, x: 66, y: 18, strength_state: '5v4', is_power_play: true }),
    shot({ event_id: 3, x: 70, y: -4, strength_state: '5v5', is_goal: true }),
    shot({ event_id: 4, x: 40, y: 2, strength_state: '4v5', is_shorthanded: true }),
  ];

  it('5v5 means even strength, not "everything that is not a power play"', () => {
    const ids = toRinkEvents(mixed, '5v5').map((s) => s.id);
    expect(ids).toEqual(['2025020001-1', '2025020001-3']);
  });

  it('pp means the shot was taken on a power play', () => {
    expect(toRinkEvents(mixed, 'pp').map((s) => s.id)).toEqual(['2025020001-2']);
  });

  it('xg is every placed attempt', () => {
    expect(toRinkEvents(mixed, 'xg')).toHaveLength(4);
  });

  it('g-xg is goals only', () => {
    expect(toRinkEvents(mixed, 'g-xg').map((s) => s.id)).toEqual(['2025020001-3']);
  });

  it('never emits an unplaceable shot into the map', () => {
    const withBad = [...mixed, shot({ event_id: 9, x: 74, y: 0, distance: 90 })];
    expect(toRinkEvents(withBad, 'xg')).toHaveLength(4);
  });

  it('carries the strength tag through so the primitive can style it', () => {
    const all = toRinkEvents(mixed, 'xg');
    expect(all.find((s) => s.id === '2025020001-2')!.mode).toBe('pp');
    expect(all.find((s) => s.id === '2025020001-4')!.mode).toBe('pk');
    expect(all.find((s) => s.id === '2025020001-1')!.mode).toBe('5v5');
  });
});

describe('careerSeries — the thing Sleeper structurally cannot show', () => {
  const row = (season: number, over: Partial<DashboardSeasonRow> = {}): DashboardSeasonRow => ({
    season,
    game_type: 'regular',
    shots: 400,
    sog: 230,
    goals: 40,
    xg: 35.5,
    finishing: 4.5,
    shots_ev: 300, shots_pp: 90, shots_pk: 10,
    goals_ev: 28, goals_pp: 11, goals_sh: 1,
    xg_ev: 25, xg_pp: 9.5, xg_pk: 1,
    goals_en: 0, xg_en: 0.5,
    avg_dist: 26, avg_xg_per_shot: 0.088,
    rebounds_shot: 30, rush_shots: 60,
    ...over,
  });

  it('sorts ascending and labels every point with its season', () => {
    const arc = careerSeries([row(2025), row(2017), row(2019)], 'regular');
    expect(arc.points.map((p) => p.x)).toEqual([2017, 2019, 2025]);
    expect(arc.points[0].gameDate).toBe('2017-18');
    expect(arc.firstSeason).toBe(2017);
    expect(arc.lastSeason).toBe(2025);
    expect(arc.endpoint).toBe('35.50');
  });

  // A 12-game playoff run next to an 82-game season in one line reads as a
  // collapse. One game type per chart.
  it('keeps one game type out of the other', () => {
    const rows = [row(2025), row(2025, { game_type: 'playoff', xg: 2.08 })];
    expect(careerSeries(rows, 'regular').points).toHaveLength(1);
    expect(careerSeries(rows, 'playoff').points[0].y).toBeCloseTo(2.08);
  });

  it('is empty, not zeroed, when there is nothing on record', () => {
    const arc = careerSeries([], 'regular');
    expect(arc.points).toEqual([]);
    expect(arc.endpoint).toBeNull();
    expect(arc.firstSeason).toBeNull();
  });

  it('seasonRow finds exactly the season and game type the page is describing', () => {
    const rows = [row(2024), row(2025), row(2025, { game_type: 'playoff' })];
    expect(seasonRow(rows, 2025, 'regular')!.season).toBe(2025);
    expect(seasonRow(rows, 2025, 'playoff')!.game_type).toBe('playoff');
    expect(seasonRow(rows, 2009, 'regular')).toBeNull();
  });
});

describe('formatting', () => {
  it('seasonLabel spans the two calendar years the season runs across', () => {
    expect(seasonLabel(2025)).toBe('2025-26');
    expect(seasonLabel(2017)).toBe('2017-18');
    expect(seasonLabel(2099)).toBe('2099-00');
  });

  // Shipped "71TH PERCENTILE" in the Wrapped chapter until the harness
  // screenshot caught it — the callout had a hardcoded "th".
  it('ordinal gets the English right, including the teens', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(71)).toBe('71st');
    expect(ordinal(100)).toBe('100th');
  });

  it('signed uses a real minus sign so a column of figures lines up', () => {
    expect(signed(7.53)).toBe('+7.53');
    expect(signed(-5.12)).toBe('−5.12');
    expect(signed(0)).toBe('+0.00');
    expect(signed(-0.4, 1)).toBe('−0.4');
  });
});

describe('verdicts — assembled from measured values, never generated', () => {
  const busySeason = Array.from({ length: 60 }, () => shot({ x: 77, y: 1, xg: 0.25 }));

  it('says nothing at all below the sample floor', () => {
    expect(deriveShotVerdict(summariseShots(busySeason.slice(0, 5)), 4)).toBeNull();
  });

  // A dropcap pulls the FIRST CHARACTER out at 48px. A verdict that opens
  // with a digit renders "3" beside "0% of his attempts…" — see the note in
  // deriveShotVerdict.
  it('never opens with a digit, because the tile dropcaps the first character', () => {
    const v = deriveShotVerdict(summariseShots(busySeason), 7.5)!;
    expect(v[0]).toMatch(/[A-Za-z]/);
    expect(
      deriveGoalieVerdict({ shots_faced: 100, xga: 8, ga: 7, raw_gsax: 1, regressed_gsax: 0.5 })![0],
    ).toMatch(/[A-Za-z]/);
  });

  it('names the busiest zone, its share and our model’s xG per attempt there', () => {
    const v = deriveShotVerdict(summariseShots(busySeason), 7.5)!;
    expect(v).toContain('He takes 100% of his attempts from the low slot');
    // The model is NAMED (2026-09-02 voice brief): "our model" was
    // unattributable and the copy rules require the source in the sentence.
    expect(v).toContain('0.250 expected goals apiece on Citrus xG v3');
    expect(v).toContain('7.5 goals ahead');
  });

  it('reads a negative finishing number as behind, not as bad', () => {
    const v = deriveShotVerdict(summariseShots(busySeason), -3.2)!;
    expect(v).toContain('3.2 goals behind');
    expect(v).not.toMatch(/bad|poor|terrible/i);
  });

  it('drops the finishing clause entirely when there is no finishing number', () => {
    const v = deriveShotVerdict(summariseShots(busySeason), null)!;
    expect(v).not.toContain('expects');
  });

  it('the goalie verdict states shots faced, expected against and allowed', () => {
    const v = deriveGoalieVerdict({
      shots_faced: 1204,
      xga: 96.4,
      ga: 89,
      raw_gsax: 7.4,
      regressed_gsax: 4.9,
    })!;
    expect(v).toContain('1,204 primary shots');
    expect(v).toContain('96.4 goals against');
    expect(v).toContain('he allowed 89');
    expect(v).toContain('7.4 goals better than expectation');
    expect(v).toContain('+4.9 once regressed');
  });

  it('says nothing when there is no GSAx row', () => {
    expect(deriveGoalieVerdict(null)).toBeNull();
    expect(
      deriveGoalieVerdict({ shots_faced: 0, xga: 0, ga: 0, raw_gsax: 0, regressed_gsax: 0 }),
    ).toBeNull();
  });
});
