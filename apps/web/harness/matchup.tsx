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

const skater = (over: Partial<MatchupPlayer>): MatchupPlayer =>
  ({
    id: 1,
    name: 'Connor McDavid',
    position: 'C',
    team: 'EDM',
    points: 0,
    gamesRemaining: 3,
    status: null,
    isStarter: true,
    stats: { goals: 34, assists: 66, sog: 219, blk: 21, gamesPlayed: 71, xGoals: 31.2, powerPlayPoints: 38 },
    total_points: 22.4,
    daily_projection: proj(6.2),
    games: [],
    ...over,
  }) as MatchupPlayer;

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
  skater({ id: 1, games: [game('EDM', 'TOR')] }),
  skater({
    id: 2,
    name: 'Auston Matthews',
    position: 'C',
    team: 'TOR',
    total_points: 31.8,
    games: [game('EDM', 'TOR', { status: 'live', home_score: 2, away_score: 1, period: 'P2' })],
    daily_total_points: 8.4,
    daily_stats_breakdown: { Goals: { count: 1, points: 6 }, SOG: { count: 4, points: 2.4 } },
  }),
  skater({ id: 3, name: 'Kirill Kaprizov', position: 'LW', team: 'MIN', total_points: 18.1, games: [game('MIN', 'STL')] }),
  skater({ id: 4, name: 'Nikita Kucherov', position: 'RW', team: 'TBL', total_points: 27.6, games: [], daily_projection: undefined }),
  skater({
    id: 5,
    name: 'Cale Makar',
    position: 'D',
    team: 'COL',
    total_points: 15.9,
    games: [game('COL', 'VGK', { status: 'final', home_score: 4, away_score: 2 })],
    daily_total_points: 11.2,
  }),
  skater({ id: 6, name: 'Quinn Hughes', position: 'D', team: 'VAN', total_points: 12.3, games: [game('VAN', 'CGY')] }),
  skater({
    id: 7,
    name: 'Igor Shesterkin',
    position: 'G',
    team: 'NYR',
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
    games: [game('NYR', 'NJD')],
  }),
  null,
];

const OPP: (MatchupPlayer | null)[] = [
  skater({ id: 11, name: 'Nathan MacKinnon', team: 'COL', total_points: 29.9, games: [game('COL', 'VGK')] }),
  skater({ id: 12, name: 'Jack Hughes', team: 'NJD', total_points: 9.4, roster_status: 'IR', games: [], daily_projection: undefined }),
  skater({ id: 13, name: 'Alexander Wennberg-Nylander', position: 'LW', team: 'SEA', total_points: 6.7, games: [game('SEA', 'LAK')] }),
  skater({ id: 14, name: 'Mitch Marner', position: 'RW', team: 'TOR', total_points: 24.2, games: [game('EDM', 'TOR')] }),
  skater({ id: 15, name: 'Roman Josi', position: 'D', team: 'NSH', total_points: 17.5, games: [game('NSH', 'DAL')] }),
  null,
  skater({
    id: 17,
    name: 'Jake Oettinger',
    position: 'G',
    team: 'DAL',
    isGoalie: true,
    total_points: 26.1,
    daily_projection: undefined,
    goalieStats: { gamesPlayed: 53, wins: 35, saves: 1430, shutouts: 2, goalsAgainst: 138, gaa: 2.72, savePct: 0.9053 },
    games: [game('NSH', 'DAL', { status: 'final', home_score: 1, away_score: 3 })],
    daily_total_points: 12.8,
  }),
  skater({ id: 18, name: 'Sam Reinhart', position: 'RW', team: 'FLA', total_points: 21.0, games: [game('FLA', 'BOS')] }),
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
