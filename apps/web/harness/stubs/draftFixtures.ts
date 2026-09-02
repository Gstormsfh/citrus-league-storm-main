/** Shared fixture data for the draft-room harness. Deterministic, no clock. */
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

const NAMES = [
  ['Connor McDavid', 'C', 'EDM'], ['Nathan MacKinnon', 'C', 'COL'],
  ['Auston Matthews', 'C', 'TOR'], ['Cale Makar', 'D', 'COL'],
  ['Leon Draisaitl', 'C', 'EDM'], ['Nikita Kucherov', 'RW', 'TBL'],
  ['David Pastrnak', 'RW', 'BOS'], ['Quinn Hughes', 'D', 'VAN'],
  ['Kirill Kaprizov', 'LW', 'MIN'], ['Mitch Marner', 'RW', 'TOR'],
  ['Artemi Panarin', 'LW', 'NYR'], ['Jack Hughes', 'C', 'NJD'],
  ['Igor Shesterkin', 'G', 'NYR'], ['Connor Hellebuyck', 'G', 'WPG'],
  ['Roman Josi', 'D', 'NSH'], ['Adam Fox', 'D', 'NYR'],
  ['Jake Oettinger', 'G', 'DAL'], ['Brady Tkachuk', 'LW', 'OTT'],
  ['Elias Pettersson', 'C', 'VAN'], ['Tage Thompson', 'C', 'BUF'],
  ['Evan Bouchard', 'D', 'EDM'], ['Matthew Tkachuk', 'LW', 'FLA'],
  ['Sidney Crosby', 'C', 'PIT'], ['Aleksander Barkov', 'C', 'FLA'],
] as const;

/** 240 players, deterministic stats descending by rank. */
export const PLAYERS = Array.from({ length: 240 }, (_, i) => {
  const [name, position, team] = NAMES[i % NAMES.length];
  const tier = Math.floor(i / NAMES.length);
  const goalie = position === 'G';
  const gp = 82 - (i % 14);
  return {
    id: String(8470000 + i),
    full_name: tier === 0 ? name : `${name} ${tier + 1}`,
    position,
    eligible_positions: [position],
    team,
    jersey_number: String((i % 88) + 1),
    status: null,
    roster_status: null,
    is_ir_eligible: false,
    headshot_url: null,
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
