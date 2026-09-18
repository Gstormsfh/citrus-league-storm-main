import { playerEligiblePositions } from '@citrus/shared';
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
import { normalizeSavePctValue } from '@citrus/shared';

export type SkaterSortKey = 'points' | 'goals' | 'assists' | 'sog' | 'xg_per_60' | 'gar_per_60' | 'proj_fantasy_points';
export type GoalieSortKey = 'wins' | 'save_pct' | 'saves' | 'shutouts' | 'proj_wins' | 'proj_gp';

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
export const svp = (v: number | null | undefined) => {
  const rate = normalizeSavePctValue(v);
  return rate == null ? '–' : rate.toFixed(3).replace(/^0/, '');
};

/** Normalize before ranking too: .920 must rank above per-mille 912. */
export function leaderboardSortValue(p: DashboardIndexEntry, key: SkaterSortKey | GoalieSortKey): number | null {
  if (key === 'save_pct') return normalizeSavePctValue(p.save_pct);
  const value = p[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function projectedWorkloadLabel(p: DashboardIndexEntry): string | null {
  return p.is_goalie && typeof p.proj_gp === 'number' && Number.isFinite(p.proj_gp) && p.proj_gp >= 0
    ? `${Number(p.proj_gp.toFixed(1))} proj. starts` : null;
}

export const SKATER_SORTS: SortOption<SkaterSortKey>[] = [
  { key: 'points', label: 'PTS', help: 'Actual points in the displayed source season', figure: (p) => int(p.points) },
  { key: 'goals', label: 'G', help: 'Goals', figure: (p) => int(p.goals) },
  { key: 'assists', label: 'A', help: 'Assists', figure: (p) => int(p.assists) },
  { key: 'sog', label: 'SOG', help: 'Shots on goal', figure: (p) => int(p.sog) },
  { key: 'xg_per_60', label: 'xG/60', help: 'Expected goals per 60 minutes. Shot quality', figure: (p) => f2(p.xg_per_60) },
  { key: 'gar_per_60', label: 'GAR/60', help: 'Goals above replacement per 60 minutes. Total impact', figure: (p) => f2(p.gar_per_60) },
  { key: 'proj_fantasy_points', label: 'PROJ', help: 'Rolled-forward fantasy points, rest of season', figure: (p) => f1(p.proj_fantasy_points), tone: 'orange' },
];

export const GOALIE_SORTS: SortOption<GoalieSortKey>[] = [
  { key: 'wins', label: 'W', help: 'Actual wins in the displayed source season', figure: (p) => int(p.wins) },
  { key: 'save_pct', label: 'SV%', help: 'Save percentage', figure: (p) => svp(p.save_pct) },
  { key: 'saves', label: 'SV', help: 'Saves', figure: (p) => int(p.saves) },
  { key: 'shutouts', label: 'SO', help: 'Shutouts', figure: (p) => int(p.shutouts) },
  { key: 'proj_wins', label: 'PROJ W', help: 'Rolled-forward wins, rest of season', figure: (p) => f1(p.proj_wins), tone: 'orange' },
  { key: 'proj_gp', label: 'PROJ STARTS', help: 'Expected remaining starts, not past appearances or confirmed starters', figure: (p) => f1(p.proj_gp), tone: 'orange' },
];

/** The shared card's shape, from what the index holds and nothing more. */
/** Season ice time over games played, as the card prints it: `18:42`. */
export function toiPerGame(seasonSeconds: number, gp: number): string {
  const per = Math.round(seasonSeconds / gp);
  const m = Math.floor(per / 60);
  const s = per % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * THE STAT LINE (2026-09-05). "Players needs to show more statistics, not
 * just proj points." One line under the club: the counting stats a
 * manager scans a pool by, in the order the scoring counts them. A goalie
 * gets his own four. Nothing a row does not have is printed as a zero:
 * a player with no games played gets no line at all.
 */
export function browseStatLine(p: DashboardIndexEntry): string | null {
  if (!p.gp) return null;
  if (p.is_goalie) {
    const sv = svp(p.save_pct);
    return [`${p.gp} actual GP`, `${p.wins}W`, sv !== '–' ? `${sv} SV%` : null, p.gaa > 0 ? `${p.gaa.toFixed(2)} GAA` : null]
      .filter(Boolean)
      .join(' · ');
  }
  // GP leads the line (the column it replaced). The name column holds ~34
  // characters of 10px mono at 393 wide, so goals and assists share a
  // cell the way a box score writes them: `55G 80A`.
  return `${p.gp} GP · ${p.goals}G ${p.assists}A · ${p.sog} SOG · ${p.ppp} PPP`;
}

export function dashboardEntryToHockeyPlayer(p: DashboardIndexEntry): HockeyPlayer {
  return {
    statsSeason: p.actuals_season ?? null,
    id: p.id,
    name: p.name,
    position: p.position,
    eligible_positions: playerEligiblePositions(p),
    number: p.jersey ?? 0,
    starter: false,
    team: p.team,
    teamAbbreviation: p.team,
    image: p.headshot_url ?? undefined,
    status: p.roster_status && ['IR', 'LTIR'].includes(p.roster_status) ? 'IR' : null,
    availability: p.availability,
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
          // The card's GSAx cell reads this; the index carries the regressed figure.
          goalsSavedAboveExpected: p.gsax_regressed ?? undefined,
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
