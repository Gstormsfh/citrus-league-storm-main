/** Shared fixture data for the draft-room harness. Deterministic, no clock. */
import { HARNESS_PLAYERS, harnessHeadshotUrl } from '../players';

export const TEAM_COUNT = 12;
export const ROUNDS = 14;

export const TEAMS = Array.from({ length: TEAM_COUNT }, (_, i) => ({
  id: `team-${i + 1}`,
  team_name: [
    'Frozen Ropes', 'Blue Line Bandits', 'Crease Crashers', 'Top Cheddar',
    'Slot Machines', 'Gordie Howitzers', 'Neutral Zone Trap', 'Five Hole Fellas',
    'Sin Bin Syndicate', 'Backcheck Brigade', 'Celly Squad', 'Puck Luck',
  ][i],
  owner_name: `Manager ${i + 1}`,
  user_id: i === 0 ? 'harness-user' : `user-${i + 1}`,
}));

export const MY_TEAM_ID = 'team-1';

/** Snake order: odd rounds 1..12, even rounds 12..1. */
export function snakeMatrix(rounds = ROUNDS) {
  const out: { round: number; pickNumber: number; teamId: string }[] = [];
  let pick = 1;
  for (let r = 1; r <= rounds; r++) {
    const order = r % 2 === 1 ? TEAMS : [...TEAMS].reverse();
    for (const t of order) out.push({ round: r, pickNumber: pick++, teamId: t.id });
  }
  return out;
}

/**
 * THE POOL IS REAL (2026-09-02). This fixture used to build 240 rows out of
 * 24 typed names by appending a counter — "Connor McDavid 2", "Cale Makar 3"
 * — and set `headshot_url: null` on every one, so `PlayerPool` drew no face
 * at all and the draft room, a review surface like any other, went out in
 * screenshots as a list of blank rows with numbered names. Production is not
 * like that: 801 of 801 rows in `players` carry a headshot_url and every one
 * is on the NHL CDN.
 *
 * 240 rows out of a 60-player roster means the roster CYCLES four times: four
 * rows read "Connor McDavid", each with its own id, rank and stat line. That
 * is a fixture repeating, which a reviewer can see and reason about. A counter
 * welded onto a name is a string the NHL cannot produce, and it is what put
 * "Nathan MacKinnon 2" in front of reviewers for months.
 *
 * DEPTH IS THE POINT: 240 is what the pool's scrolling, filtering and search
 * are sized against, so the count stays 240 rather than shrinking to 60.
 *
 * The stat lines stay synthetic and strictly descending by rank — the pool
 * sorts on them, and four identical real stat lines would flatten the order
 * the room is meant to show.
 */
export const PLAYERS = Array.from({ length: 240 }, (_, i) => {
  const p = HARNESS_PLAYERS[i % HARNESS_PLAYERS.length];
  const position = p.position;
  const goalie = position === 'G';
  const gp = 82 - (i % 14);
  return {
    id: String(8470000 + i),
    full_name: p.name,
    position,
    eligible_positions: [position],
    team: p.team,
    jersey_number: p.jersey,
    status: null,
    roster_status: null,
    is_ir_eligible: false,
    headshot_url: harnessHeadshotUrl(p.team, p.nhlId),
    last_updated: null,
    games_played: goalie ? 0 : gp,
    goalie_gp: goalie ? 55 - (i % 20) : undefined,
    goals: goalie ? 0 : Math.max(0, 55 - i),
    assists: goalie ? 0 : Math.max(0, 80 - i),
    points: goalie ? 0 : Math.max(0, 135 - 2 * i),
    plus_minus: 20 - (i % 40),
    shots: goalie ? 0 : Math.max(0, 320 - 2 * i),
    hits: goalie ? 0 : 90 - (i % 60),
    blocks: goalie ? 0 : 70 - (i % 50),
    pim: 24, ppp: Math.max(0, 40 - i), shp: i % 3,
    icetime_seconds: goalie ? 198000 : 76000 - i * 20,
    xGoals: Math.max(0, 40 - i),
    wins: goalie ? 38 - (i % 18) : null,
    losses: goalie ? 16 : null, ot_losses: goalie ? 5 : null,
    saves: goalie ? 1600 - i : null, shutouts: goalie ? 4 : null,
    shots_faced: goalie ? 1750 - i : null, goals_against: goalie ? 120 : null,
    goals_against_average: goalie ? 2.45 : null,
    save_percentage: goalie ? 0.918 : null,
    highDangerSavePct: 0, goalsSavedAboveExpected: 0,
  };
});
