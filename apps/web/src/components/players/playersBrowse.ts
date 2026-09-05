/**
 * THE PLAYERS TAB, AS DATA (2026-09-04).
 *
 * The league-wide browser's sort keys and the figure each one shows on a
 * row, plus the adapter that turns a dashboard-index entry into the
 * HockeyPlayer the shared player card takes, so a row tap on the phone
 * opens the same card every other surface opens. Nothing is invented: a
 * rate with no sample renders `–`, a goalie's projected wins stay a
 * goalie's, and the season line carries only what the index holds.
 */
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

export type SkaterSortKey = 'points' | 'goals' | 'assists' | 'sog' | 'xg_per_60' | 'gar_per_60' | 'proj_fantasy_points';
export type GoalieSortKey = 'wins' | 'save_pct' | 'saves' | 'shutouts' | 'proj_wins';

export interface SortOption<K extends string> {
  key: K;
  /** The column head and the chip: `PTS`, `xG/60`. */
  label: string;
  /** The picker's line. */
  help: string;
  /** Format the figure for the row. */
  figure: (p: DashboardIndexEntry) => string;
  /** The figure a manager scans for first takes orange. */
  tone?: 'orange' | 'sage';
}

const f1 = (v: number | null | undefined) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const f2 = (v: number | null | undefined) => (v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2));
const int = (v: number | null | undefined) => (v == null ? '–' : String(v));
/** `.912` — the artboard's spelling for a save percentage. */
export const svp = (v: number | null | undefined) =>
  v == null || v === 0 ? '–' : (v < 1 ? v : v / 1000).toFixed(3).replace(/^0/, '');

export const SKATER_SORTS: SortOption<SkaterSortKey>[] = [
  { key: 'points', label: 'PTS', help: 'Points this season', figure: (p) => int(p.points) },
  { key: 'goals', label: 'G', help: 'Goals', figure: (p) => int(p.goals) },
  { key: 'assists', label: 'A', help: 'Assists', figure: (p) => int(p.assists) },
  { key: 'sog', label: 'SOG', help: 'Shots on goal', figure: (p) => int(p.sog) },
  { key: 'xg_per_60', label: 'xG/60', help: 'Expected goals per 60 minutes. Shot quality', figure: (p) => f2(p.xg_per_60) },
  { key: 'gar_per_60', label: 'GAR/60', help: 'Goals above replacement per 60 minutes. Total impact', figure: (p) => f2(p.gar_per_60) },
  { key: 'proj_fantasy_points', label: 'PROJ', help: 'Rolled-forward fantasy points, rest of season', figure: (p) => f1(p.proj_fantasy_points), tone: 'orange' },
];

export const GOALIE_SORTS: SortOption<GoalieSortKey>[] = [
  { key: 'wins', label: 'W', help: 'Wins this season', figure: (p) => int(p.wins) },
  { key: 'save_pct', label: 'SV%', help: 'Save percentage', figure: (p) => svp(p.save_pct) },
  { key: 'saves', label: 'SV', help: 'Saves', figure: (p) => int(p.saves) },
  { key: 'shutouts', label: 'SO', help: 'Shutouts', figure: (p) => int(p.shutouts) },
  { key: 'proj_wins', label: 'PROJ W', help: 'Rolled-forward wins, rest of season', figure: (p) => f1(p.proj_wins), tone: 'orange' },
];

/** The shared card's shape, from what the index holds and nothing more. */
/** Season ice time over games played, as the card prints it: `18:42`. */
export function toiPerGame(seasonSeconds: number, gp: number): string {
  const per = Math.round(seasonSeconds / gp);
  const m = Math.floor(per / 60);
  const s = per % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function dashboardEntryToHockeyPlayer(p: DashboardIndexEntry): HockeyPlayer {
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    number: p.jersey ?? 0,
    starter: false,
    team: p.team,
    teamAbbreviation: p.team,
    image: p.headshot_url ?? undefined,
    status: p.roster_status && ['IR', 'LTIR'].includes(p.roster_status) ? 'IR' : null,
    roster_status: p.roster_status ?? undefined,
    stats: p.is_goalie
      ? {
          gamesPlayed: p.gp,
          wins: p.wins,
          losses: p.losses,
          otl: p.ot_losses,
          saves: p.saves,
          savePct: p.save_pct,
          gaa: p.gaa,
          shutouts: p.shutouts,
          goalsAgainst: p.goals_against,
        }
      : {
          gamesPlayed: p.gp,
          goals: p.goals,
          assists: p.assists,
          points: p.points,
          shots: p.sog,
          hits: p.hits,
          blockedShots: p.blocks,
          powerPlayPoints: p.ppp,
          shortHandedPoints: p.shp,
          pim: p.pim,
          plusMinus: p.plus_minus,
          xGoals: p.x_goals,
          // The card prints TOI per game as mm:ss; the index carries the season total.
          toi: p.gp > 0 && p.toi_seconds > 0 ? toiPerGame(p.toi_seconds, p.gp) : undefined,
        },
  };
}
