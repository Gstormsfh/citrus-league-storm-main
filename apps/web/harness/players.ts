/**
 * The harness roster: 60 REAL NHL players, with their real teams, sweater
 * numbers, NHL player ids and 2025-26 stat lines, read out of the production
 * `players` table on 2026-09-02.
 *
 * WHY THIS FILE EXISTS
 *
 * The harness README promises "what renders here is what renders in the app".
 * That was not true of the single most visible element on every row. Three
 * fixtures set `headshot_url: null` (page.tsx, main.tsx, stubs/draftFixtures.ts)
 * and the other six entry points omitted a face field altogether, so `Mug` fell
 * all the way through headshot -> crest -> initials on EVERY harness surface.
 * Every phone screenshot this repo has produced shows initials discs.
 * Production does not: measured the same day, 801 of 801 rows in `players`
 * carry a headshot_url and every one of them is on the NHL CDN.
 *
 * The names were worse than absent. page.tsx wrapped an 18-name list to reach
 * 60 by appending a counter -- "Connor McDavid 2", "Nathan MacKinnon 2" -- and
 * main.tsx used "Roster Player 01". Both put a synthetic string where the row's
 * primary read belongs, and both went out in review screenshots.
 *
 * So: one roster, real, shared by every harness entry. A reviewer looking at
 * the harness is looking at what a manager will see.
 *
 * THE URL is built, not stored, so it stays greppable and provably identical
 * to the shape production serves:
 *   https://assets.nhle.com/mugs/nhl/20252026/<TEAM>/<nhlId>.png
 *
 * ORDER is deliberate: the first 18 are a legal 18-man roster (5xC, 5xD, 2xG, 3xLW, 3xRW), so
 * every entry point that slices the head of this list gets a startable lineup.
 * A fixture that cannot be started is a fixture nobody reviews twice.
 */
export const HEADSHOT_SEASON = '20252026';

/** The exact URL shape production stores. Keep this the only place it is built. */
export function harnessHeadshotUrl(team: string, nhlId: string): string {
  return `https://assets.nhle.com/mugs/nhl/${HEADSHOT_SEASON}/${team}/${nhlId}.png`;
}

export interface HarnessPlayer {
  name: string;
  position: 'C' | 'LW' | 'RW' | 'D' | 'G';
  team: string;
  jersey: string;
  /** Real NHL player id. Half of the headshot URL; never invent one. */
  nhlId: string;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  shots?: number;
  wins?: number;
  losses?: number;
  otLosses?: number;
  gaa?: number;
  savePct?: number;
}

export const HARNESS_PLAYERS: HarnessPlayer[] = [
  { name: "Aleksander Barkov", position: 'C', team: 'FLA', jersey: '16', nhlId: '8477493', goals: 20, assists: 51, points: 71, plusMinus: 1, shots: 149 },
  { name: "Jason Robertson", position: 'LW', team: 'DAL', jersey: '21', nhlId: '8480027', goals: 14, assists: 17, points: 31, plusMinus: 10, shots: 102 },
  { name: "William Nylander", position: 'RW', team: 'TOR', jersey: '88', nhlId: '8477939', goals: 11, assists: 20, points: 31, plusMinus: 7, shots: 47 },
  { name: "Cale Makar", position: 'D', team: 'COL', jersey: '8', nhlId: '8480069', goals: 9, assists: 21, points: 30, plusMinus: 24, shots: 66 },
  { name: "Josh Morrissey", position: 'D', team: 'WPG', jersey: '44', nhlId: '8477504', goals: 5, assists: 18, points: 23, plusMinus: 9, shots: 38 },
  { name: "Nathan MacKinnon", position: 'C', team: 'COL', jersey: '29', nhlId: '8477492', goals: 18, assists: 21, points: 39, plusMinus: 26, shots: 99 },
  { name: "David Pastrnak", position: 'RW', team: 'BOS', jersey: '88', nhlId: '8477956', goals: 11, assists: 18, points: 29, plusMinus: -8, shots: 86 },
  { name: "Cutter Gauthier", position: 'LW', team: 'ANA', jersey: '61', nhlId: '8483445', goals: 14, assists: 14, points: 28, plusMinus: 14, shots: 98 },
  { name: "Adam Fox", position: 'D', team: 'NYR', jersey: '23', nhlId: '8479323', goals: 3, assists: 19, points: 22, plusMinus: 3, shots: 49 },
  { name: "Connor McDavid", position: 'C', team: 'EDM', jersey: '97', nhlId: '8478402', goals: 10, assists: 24, points: 34, plusMinus: -6, shots: 73 },
  { name: "Scott Wedgewood", position: 'G', team: 'COL', jersey: '41', nhlId: '8475809', wins: 13, losses: 1, otLosses: 2, gaa: 2.090878, savePct: 0.918072 },
  { name: "Carter Hart", position: 'G', team: 'VGK', jersey: '79', nhlId: '8479394', wins: 12, losses: 9, otLosses: 3, gaa: 2.80377, savePct: 0.906465 },
  { name: "Macklin Celebrini", position: 'C', team: 'SJS', jersey: '71', nhlId: '8484801', goals: 14, assists: 20, points: 34, plusMinus: 3, shots: 70 },
  { name: "Kirill Kaprizov", position: 'LW', team: 'MIN', jersey: '97', nhlId: '8478864', goals: 14, assists: 14, points: 28, plusMinus: 1, shots: 80 },
  { name: "Mikko Rantanen", position: 'RW', team: 'DAL', jersey: '96', nhlId: '8478420', goals: 10, assists: 18, points: 28, plusMinus: -5, shots: 60 },
  { name: "Jakob Chychrun", position: 'D', team: 'WSH', jersey: '6', nhlId: '8479345', goals: 9, assists: 13, points: 22, plusMinus: 16, shots: 83 },
  { name: "John Carlson", position: 'D', team: 'WSH', jersey: '74', nhlId: '8474590', goals: 6, assists: 16, points: 22, plusMinus: 8, shots: 54 },
  { name: "Connor Bedard", position: 'C', team: 'CHI', jersey: '98', nhlId: '8484144', goals: 14, assists: 19, points: 33, plusMinus: 8, shots: 75 },
  { name: "Nikita Kucherov", position: 'RW', team: 'TBL', jersey: '86', nhlId: '8476453', goals: 11, assists: 16, points: 27, plusMinus: 2, shots: 63 },
  { name: "Kyle Connor", position: 'LW', team: 'WPG', jersey: '81', nhlId: '8478398', goals: 11, assists: 17, points: 28, plusMinus: 6, shots: 78 },
  { name: "Quinn Hughes", position: 'D', team: 'VAN', jersey: '43', nhlId: '8480800', goals: 2, assists: 20, points: 22, plusMinus: -5, shots: 53 },
  { name: "Jack Eichel", position: 'C', team: 'VGK', jersey: '9', nhlId: '8478403', goals: 11, assists: 20, points: 31, plusMinus: 4, shots: 94 },
  { name: "Lukas Dostal", position: 'G', team: 'ANA', jersey: '1', nhlId: '8480843', wins: 11, losses: 5, otLosses: 1, gaa: 2.813599, savePct: 0.904382 },
  { name: "Andrei Vasilevskiy", position: 'G', team: 'TBL', jersey: '88', nhlId: '8476883', wins: 10, losses: 5, otLosses: 2, gaa: 2.278367, savePct: 0.917595 },
  { name: "Leo Carlsson", position: 'C', team: 'ANA', jersey: '91', nhlId: '8484153', goals: 12, assists: 18, points: 30, plusMinus: 11, shots: 61 },
  { name: "Matt Boldy", position: 'LW', team: 'MIN', jersey: '12', nhlId: '8481557', goals: 14, assists: 14, points: 28, plusMinus: 5, shots: 81 },
  { name: "Alex DeBrincat", position: 'RW', team: 'DET', jersey: '93', nhlId: '8479337', goals: 12, assists: 14, points: 26, plusMinus: -3, shots: 92 },
  { name: "Zach Werenski", position: 'D', team: 'CBJ', jersey: '8', nhlId: '8478460', goals: 8, assists: 14, points: 22, plusMinus: 7, shots: 95 },
  { name: "Evan Bouchard", position: 'D', team: 'EDM', jersey: '2', nhlId: '8480803', goals: 4, assists: 17, points: 21, plusMinus: -1, shots: 68 },
  { name: "Martin Necas", position: 'C', team: 'COL', jersey: '88', nhlId: '8480039', goals: 13, assists: 17, points: 30, plusMinus: 21, shots: 49 },
  { name: "Troy Terry", position: 'RW', team: 'ANA', jersey: '19', nhlId: '8478873', goals: 7, assists: 19, points: 26, plusMinus: 11, shots: 54 },
  { name: "Brad Marchand", position: 'LW', team: 'FLA', jersey: '63', nhlId: '8473419', goals: 14, assists: 12, points: 26, plusMinus: -6, shots: 62 },
  { name: "Miro Heiskanen", position: 'D', team: 'DAL', jersey: '4', nhlId: '8480036', goals: 3, assists: 17, points: 20, plusMinus: 1, shots: 54 },
  { name: "Leon Draisaitl", position: 'C', team: 'EDM', jersey: '29', nhlId: '8477934', goals: 14, assists: 15, points: 29, plusMinus: 4, shots: 61 },
  { name: "Jake Oettinger", position: 'G', team: 'DAL', jersey: '29', nhlId: '8479979', wins: 10, losses: 4, otLosses: 2, gaa: 2.740959, savePct: 0.900452 },
  { name: "Jeremy Swayman", position: 'G', team: 'BOS', jersey: '1', nhlId: '8480280', wins: 10, losses: 6, otLosses: 0, gaa: 2.676441, savePct: 0.91502 },
  { name: "Mark Scheifele", position: 'C', team: 'WPG', jersey: '55', nhlId: '8476460', goals: 12, assists: 17, points: 29, plusMinus: 7, shots: 52 },
  { name: "Lucas Raymond", position: 'LW', team: 'DET', jersey: '23', nhlId: '8482078', goals: 7, assists: 18, points: 25, plusMinus: 5, shots: 54 },
  { name: "Tom Wilson", position: 'RW', team: 'WSH', jersey: '43', nhlId: '8476880', goals: 12, assists: 12, points: 24, plusMinus: 11, shots: 52 },
  { name: "Lane Hutson", position: 'D', team: 'MTL', jersey: '48', nhlId: '8483457', goals: 3, assists: 16, points: 19, plusMinus: 0, shots: 36 },
  { name: "Jake Sanderson", position: 'D', team: 'OTT', jersey: '85', nhlId: '8482105', goals: 4, assists: 14, points: 18, plusMinus: 2, shots: 50 },
  { name: "Alexander Kerfoot", position: 'C', team: 'UTA', jersey: '15', nhlId: '8477021', goals: 11, assists: 17, points: 28, plusMinus: -5, shots: 101 },
  { name: "Cole Caufield", position: 'RW', team: 'MTL', jersey: '13', nhlId: '8481540', goals: 13, assists: 10, points: 23, plusMinus: 10, shots: 62 },
  { name: "Nils Hoglander", position: 'LW', team: 'VAN', jersey: '21', nhlId: '8481535', goals: 8, assists: 17, points: 25, plusMinus: 5, shots: 83 },
  { name: "Morgan Rielly", position: 'D', team: 'TOR', jersey: '44', nhlId: '8476853', goals: 3, assists: 14, points: 17, plusMinus: -6, shots: 44 },
  { name: "John Tavares", position: 'C', team: 'TOR', jersey: '91', nhlId: '8475166', goals: 12, assists: 16, points: 28, plusMinus: 4, shots: 69 },
  { name: "Karel Vejmelka", position: 'G', team: 'UTA', jersey: '70', nhlId: '8478872', wins: 10, losses: 6, otLosses: 2, gaa: 2.835127, savePct: 0.886364 },
  { name: "Sergei Bobrovsky", position: 'G', team: 'FLA', jersey: '72', nhlId: '8475683', wins: 10, losses: 7, otLosses: 0, gaa: 2.875008, savePct: 0.882206 },
  { name: "Dylan Larkin", position: 'C', team: 'DET', jersey: '71', nhlId: '8477946', goals: 13, assists: 13, points: 26, plusMinus: 8, shots: 81 },
  { name: "Brandon Hagel", position: 'LW', team: 'TBL', jersey: '38', nhlId: '8479542', goals: 12, assists: 12, points: 24, plusMinus: 12, shots: 65 },
  { name: "Kirill Marchenko", position: 'RW', team: 'CBJ', jersey: '86', nhlId: '8480893', goals: 8, assists: 14, points: 22, plusMinus: 8, shots: 65 },
  { name: "Oliver Ekman-Larsson", position: 'D', team: 'TOR', jersey: '95', nhlId: '8475171', goals: 3, assists: 14, points: 17, plusMinus: 5, shots: 34 },
  { name: "Matthew Schaefer", position: 'D', team: 'NYI', jersey: '48', nhlId: '8485366', goals: 7, assists: 9, points: 16, plusMinus: 8, shots: 71 },
  { name: "Nick Suzuki", position: 'C', team: 'MTL', jersey: '14', nhlId: '8480018', goals: 7, assists: 19, points: 26, plusMinus: 12, shots: 46 },
  { name: "Mitch Marner", position: 'RW', team: 'VGK', jersey: '93', nhlId: '8478483', goals: 4, assists: 18, points: 22, plusMinus: 6, shots: 43 },
  { name: "Matthew Knies", position: 'LW', team: 'TOR', jersey: '23', nhlId: '8482720', goals: 5, assists: 18, points: 23, plusMinus: 3, shots: 44 },
  { name: "Alex Ovechkin", position: 'LW', team: 'WSH', jersey: '8', nhlId: '8471214', goals: 11, assists: 11, points: 22, plusMinus: 8, shots: 57 },
  { name: "Alex Tuch", position: 'RW', team: 'BUF', jersey: '89', nhlId: '8477949', goals: 8, assists: 13, points: 21, plusMinus: 1, shots: 52 },
  { name: "Artemi Panarin", position: 'LW', team: 'NYR', jersey: '10', nhlId: '8478550', goals: 7, assists: 15, points: 22, plusMinus: -4, shots: 66 },
  { name: "Clayton Keller", position: 'RW', team: 'UTA', jersey: '9', nhlId: '8479343', goals: 8, assists: 13, points: 21, plusMinus: 0, shots: 68 },
];

/**
 * The one player on the roster with this exact name, or a loud failure.
 *
 * The entry points name the players they want ("Connor McDavid" in the LIVE
 * locked row, "Jake Oettinger" in the final-game goalie row) because the
 * STATE each row tests is bound to a specific player, not to a list index.
 * A `find` that returned `undefined` would render a blank row and read as a
 * layout bug, so this throws instead: the harness exists to be believed.
 */
export function harnessPlayer(name: string): HarnessPlayer {
  const found = HARNESS_PLAYERS.find((p) => p.name === name);
  if (!found) throw new Error(`harness fixture asked for "${name}", who is not on the harness roster`);
  return found;
}

/** `HarnessPlayer` -> the player-directory shape the pages consume. */
export function harnessDirectoryPlayer(p: HarnessPlayer, index: number) {
  const goalie = p.position === 'G';
  return {
    id: String(7000 + index),
    full_name: p.name,
    position: p.position,
    eligible_positions: [p.position],
    team: p.team,
    jersey_number: p.jersey,
    status: 'active',
    roster_status: null,
    is_ir_eligible: false,
    headshot_url: harnessHeadshotUrl(p.team, p.nhlId),
    last_updated: null,
    games_played: goalie ? (p.wins ?? 0) + (p.losses ?? 0) + (p.otLosses ?? 0) : 24,
    goals: p.goals ?? 0,
    assists: p.assists ?? 0,
    points: p.points ?? 0,
    plus_minus: p.plusMinus ?? 0,
    shots: p.shots ?? 0,
    hits: 0,
    blocks: 0,
    pim: 0,
    ppp: 0,
    shp: 0,
    icetime_seconds: goalie ? 140000 : 76000,
    xGoals: 0,
    wins: p.wins ?? null,
    losses: p.losses ?? null,
    ot_losses: p.otLosses ?? null,
    saves: null,
    shutouts: null,
    shots_faced: null,
    goals_against: null,
    goals_against_average: p.gaa ?? null,
    save_percentage: p.savePct ?? null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
    goalie_gp: goalie ? (p.wins ?? 0) + (p.losses ?? 0) + (p.otLosses ?? 0) : undefined,
  };
}

/** The same roster as the minimum a row needs to draw a face (`MugPlayer`). */
export function harnessMug(p: HarnessPlayer) {
  return { name: p.name, image: harnessHeadshotUrl(p.team, p.nhlId), team: p.team };
}

/**
 * The identity + face fields the ROW shapes read. `HockeyPlayer` (roster,
 * cards) and `MatchupPlayer` (matchup) both carry `image`, and both draw
 * their crest off `teamAbbreviation` before `team` -- so a fixture that set
 * only `team` would still be one field short of the app.
 *
 * Spread it, then override the state the row exists to test (`status: 'IR'`,
 * zeroed stats, a locked chip). Identity and face come from here; the state
 * stays where it is written.
 */
export function harnessRowPlayer(p: HarnessPlayer) {
  return {
    ...harnessMug(p),
    teamAbbreviation: p.team,
    position: p.position,
    number: Number(p.jersey),
  };
}
