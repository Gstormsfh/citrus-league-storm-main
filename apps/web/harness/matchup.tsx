/**
 * The mobile MATCHUP lineup rows at a phone viewport — real
 * `MatchupPositionGroup` / `MatchupComparisonRow` / `PlayerCard` /
 * `CenterColumn`, real index.css, fixture players.
 *
 * Why this exists rather than `page.html?p=matchup` (2026-09-02): the whole
 * Matchup page needs `MatchupService` to return a matchup, and the harness
 * stubs only the three league GETs — the page renders "No matchup data
 * available" and the rows never mount, so the surface this file exists to
 * look at cannot be looked at there. The rows themselves need nothing but
 * two arrays of players, so they get mounted directly, the way cards.tsx
 * mounts MobileRosterList.
 *
 * The `.matchup-wrapper` / `.matchup-position-group` / `.matchup-team-header`
 * markup is copied from MatchupComparison so the stylesheet's mobile block
 * (`@media (max-width: 1023px)`) applies exactly as it does on the page.
 */
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { MatchupPositionGroup } from '../src/components/matchup/MatchupPositionGroup';
import type { MatchupPlayer } from '../src/components/matchup/types';
import type { NHLGame } from '../src/services/ScheduleService';
import { harnessMug, harnessPlayer } from './players';

const proj = (pts: number, over: Record<string, unknown> = {}) => ({
  total_projected_points: pts,
  projected_goals: 0.4,
  projected_assists: 0.7,
  projected_sog: 3.2,
  projected_blocks: 0.9,
  projected_xg: 0.42,
  base_ppg: 4.1,
  shrinkage_weight: 0.8,
  finishing_multiplier: 1.05,
  opponent_adjustment: 1.0,
  b2b_penalty: 0,
  home_away_adjustment: 1.02,
  confidence_score: 0.7,
  calculation_method: 'harness',
  dynamic_confidence: 0.72,
  ...over,
});

/**
 * REAL PLAYERS, REAL FACES (2026-09-02). `MatchupPlayer` has carried an
 * `image` field since the M4 audit and `PlayerCard` draws a 28px `Mug` from
 * it on every mobile row — but every fixture here was a name typed into this
 * file with no face, so the surface that exists to show those rows showed
 * sixteen initials discs. Production carries an NHL CDN headshot on all 801
 * rows of `players`.
 *
 * Identity and face come off the shared roster (harness/players.ts); the
 * per-row STATE — live score, final score, IR, no game, goalie projection
 * present or absent — stays written here, because the state is the fixture.
 *
 * TEAMS ARE LOAD-BEARING: `GameLogosBar` picks the opponent by matching the
 * player's team against the game's home/away, so a row whose player is not in
 * its own game renders the wrong "vs / @" and the wrong crest. Every
 * substitution below keeps the player and the game on the same side.
 */
const skater = (who: string, over: Partial<MatchupPlayer>): MatchupPlayer => {
  const p = harnessPlayer(who);
  return {
    id: 1,
    ...harnessMug(p),
    position: p.position,
    points: 0,
    gamesRemaining: 3,
    status: null,
    isStarter: true,
    stats: { goals: 34, assists: 66, sog: 219, blk: 21, gamesPlayed: 71, xGoals: 31.2, powerPlayPoints: 38 },
    total_points: 22.4,
    daily_projection: proj(6.2),
    games: [],
    ...over,
  } as MatchupPlayer;
};

const TODAY = new Date().toISOString().slice(0, 10);
/**
 * The handful of `NHLGame` fields the row actually reads (date, teams,
 * status, score, period). The single widening cast lives here so no call
 * site needs one — the alternative is `as any` on every fixture, which is
 * what this file is not allowed to ship (CLAUDE.md: no `any` in new code).
 */
const game = (home: string, away: string, over: Partial<NHLGame> = {}): NHLGame =>
  ({
    game_date: TODAY,
    home_team: home,
    away_team: away,
    status: 'scheduled',
    home_score: 0,
    away_score: 0,
    period: null,
    ...over,
  }) as NHLGame;

const USER: (MatchupPlayer | null)[] = [
  skater('Connor McDavid', { id: 1, games: [game('EDM', 'TOR')] }),
  // Was Auston Matthews, who is not on the harness roster. Tavares is the
  // Leaf centre it has, so the live EDM@TOR game this row tests still holds.
  skater('John Tavares', {
    id: 2,
    total_points: 31.8,
    games: [game('EDM', 'TOR', { status: 'live', home_score: 2, away_score: 1, period: 'P2' })],
    daily_total_points: 8.4,
    daily_stats_breakdown: { Goals: { count: 1, points: 6 }, SOG: { count: 4, points: 2.4 } },
  }),
  skater('Kirill Kaprizov', { id: 3, total_points: 18.1, games: [game('MIN', 'STL')] }),
  skater('Nikita Kucherov', { id: 4, total_points: 27.6, games: [], daily_projection: undefined }),
  skater('Cale Makar', {
    id: 5,
    total_points: 15.9,
    games: [game('COL', 'VGK', { status: 'final', home_score: 4, away_score: 2 })],
    daily_total_points: 11.2,
  }),
  skater('Quinn Hughes', { id: 6, total_points: 12.3, games: [game('VAN', 'CGY')] }),
  // Was Igor Shesterkin; the roster has no NYR goalie. Swayman is BOS, so the
  // game moves with him — and he now faces the opponent's UTIL row (Marchand),
  // which is what a real Sunday slate looks like.
  skater('Jeremy Swayman', {
    id: 7,
    isGoalie: true,
    total_points: 34.7,
    daily_projection: undefined,
    goalieProjection: {
      total_projected_points: 14.8,
      projected_wins: 0.6,
      projected_saves: 27.4,
      projected_shutouts: 0.08,
      projected_goals_against: 2.5,
      projected_gaa: 2.5,
      projected_save_pct: 0.915,
      projected_gp: 1,
      starter_confirmed: true,
      confidence_score: 0.8,
      calculation_method: 'harness',
    },
    goalieStats: { gamesPlayed: 55, wins: 36, saves: 1652, shutouts: 4, goalsAgainst: 142, gaa: 2.58, savePct: 0.9134 },
    games: [game('FLA', 'BOS')],
  }),
  null,
];

const OPP: (MatchupPlayer | null)[] = [
  skater('Nathan MacKinnon', { id: 11, total_points: 29.9, games: [game('COL', 'VGK')] }),
  // IR + no game is the STATE this row tests (was Jack Hughes, not on the
  // roster). Celebrini is real and healthy; the injury is the fixture.
  skater('Macklin Celebrini', { id: 12, total_points: 9.4, roster_status: 'IR', games: [], daily_projection: undefined }),
  // Was the invented 27-character "Alexander Wennberg-Nylander". The name
  // this row truncates is now one that can actually reach it.
  skater('Cutter Gauthier', { id: 13, total_points: 6.7, games: [game('ANA', 'LAK')] }),
  // Was Mitch Marner as a Leaf; he plays for VGK on this roster, and a row
  // whose team does not appear in its own game renders the wrong opponent.
  // Nylander is the Leaf winger in the EDM@TOR game.
  skater('William Nylander', { id: 14, total_points: 24.2, games: [game('EDM', 'TOR')] }),
  // Was Roman Josi, not on the roster. Fox is the defenceman it has; the game
  // moves to his team so the "vs NSH" this row prints is still true.
  skater('Adam Fox', { id: 15, total_points: 17.5, games: [game('NYR', 'NSH')] }),
  null,
  skater('Jake Oettinger', {
    id: 17,
    isGoalie: true,
    total_points: 26.1,
    daily_projection: undefined,
    goalieStats: { gamesPlayed: 53, wins: 35, saves: 1430, shutouts: 2, goalsAgainst: 138, gaa: 2.72, savePct: 0.9053 },
    games: [game('NSH', 'DAL', { status: 'final', home_score: 1, away_score: 3 })],
    daily_total_points: 12.8,
  }),
  // UTIL. Was Sam Reinhart, not on the roster; Marchand is the Panther it has.
  skater('Brad Marchand', { id: 18, total_points: 21.0, games: [game('FLA', 'BOS')] }),
];

const SLOTS = ['C', 'C', 'LW', 'RW', 'D', 'D', 'G', 'UTIL'];

function App() {
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream">
      <div className="matchup-wrapper" style={{ boxSizing: 'border-box', padding: 0, margin: 0 }}>
        <div className="matchup-team-header bg-[#1A2A20]/95 backdrop-blur-sm border-b border-white/10 mb-1">
          <div className="matchup-team-header-side matchup-team-header-user">
            <span className="inline-flex items-center bg-pastel-orange/20 text-pastel-orange-soft ring-1 ring-pastel-orange/40 rounded-md font-jbmono uppercase font-bold text-[8px] px-1 py-0 tracking-wide flex-shrink-0">
              You
            </span>
            <span className="font-varsity text-[11px] md:text-xs uppercase truncate text-pastel-orange-soft">
              Harness FC
            </span>
          </div>
          <div className="matchup-team-header-center">
            <span className="font-mono text-[9px] text-white/55 uppercase">vs</span>
          </div>
          <div className="matchup-team-header-side matchup-team-header-opponent">
            <span className="font-varsity text-[11px] md:text-xs uppercase truncate text-pastel-cream">
              Ice Wolves
            </span>
          </div>
        </div>

        <div className="matchup-position-group" data-testid="starters">
          <MatchupPositionGroup
            userPlayers={USER}
            opponentPlayers={OPP}
            slotPositions={SLOTS}
            isUtilSlot={[false, false, false, false, false, false, false, true]}
            selectedDate={null}
          />
        </div>

        <div className="matchup-position-group" data-testid="bench">
          <MatchupPositionGroup
            userPlayers={[USER[2], USER[3]]}
            opponentPlayers={[OPP[3], OPP[7]]}
            slotPositions={['BN', 'BN']}
            isBench
            selectedDate={null}
          />
        </div>

        <div className="matchup-position-group" data-testid="day-view">
          <MatchupPositionGroup
            userPlayers={USER.slice(0, 5)}
            opponentPlayers={OPP.slice(0, 5)}
            slotPositions={SLOTS.slice(0, 5)}
            selectedDate={TODAY}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
