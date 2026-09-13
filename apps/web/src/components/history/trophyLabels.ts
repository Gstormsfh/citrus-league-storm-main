/**
 * The record book's vocabulary: what each trophy key is called, how its
 * value reads, and which section of the room it belongs in. Pure, so the
 * trophy room's tests never need a DOM.
 */
import type { HistoryMember, HistoryStanding, LeagueHistory, Trophy } from '@/api/imports';

export type TrophySection = 'season' | 'record' | 'career' | 'h2h';

export interface TrophyLabel {
  title: string;
  section: TrophySection;
  /** One or two words for the row's eyebrow. */
  kicker: string;
}

export const TROPHY_LABELS: Record<string, TrophyLabel> = {
  champion: { title: 'Champion', section: 'season', kicker: 'Title' },
  runner_up: { title: 'Runner-up', section: 'season', kicker: 'Final' },
  third: { title: 'Third place', section: 'season', kicker: 'Bronze' },
  regular_season_title: { title: 'Regular season title', section: 'season', kicker: 'First seed' },
  playoff_appearance: { title: 'Made the playoffs', section: 'season', kicker: 'Playoffs' },
  toilet_bowl: { title: 'Toilet bowl', section: 'season', kicker: 'Last place' },
  comeback_seed: { title: 'Comeback champion', section: 'season', kicker: 'Low seed' },
  most_championships: { title: 'Most championships', section: 'career', kicker: 'All time' },
  championship_drought: { title: 'Championship drought', section: 'career', kicker: 'Seasons' },
  founding_member: { title: 'Founding member', section: 'career', kicker: 'Since' },
  tenure: { title: 'Seasons played', section: 'career', kicker: 'Tenure' },
  all_time_win_pct: { title: 'All-time win percentage', section: 'career', kicker: 'Record' },
  highest_week: { title: 'Highest week', section: 'record', kicker: 'Points' },
  lowest_week: { title: 'Lowest week', section: 'record', kicker: 'Points' },
  biggest_blowout: { title: 'Biggest blowout', section: 'record', kicker: 'Margin' },
  closest_game: { title: 'Closest game', section: 'record', kicker: 'Margin' },
  longest_win_streak: { title: 'Longest win streak', section: 'record', kicker: 'Games' },
  longest_losing_streak: { title: 'Longest losing streak', section: 'record', kicker: 'Games' },
  category_sweep: { title: 'Biggest category sweep', section: 'record', kicker: 'Categories' },
  narrowest_category_win: { title: 'Narrowest category win', section: 'record', kicker: 'Margin' },
  perfect_week: { title: 'Perfect week', section: 'record', kicker: 'Every category' },
  category_dominance: { title: 'Category dominance', section: 'record', kicker: 'Weekly wins' },
  lifetime_h2h: { title: 'Lifetime head-to-head', section: 'h2h', kicker: 'Record' },
  toughest_opponent: { title: 'Toughest opponent', section: 'h2h', kicker: 'Nemesis' },
  favourite_victim: { title: 'Favourite opponent', section: 'h2h', kicker: 'Win rate' },
  custom: { title: 'League trophy', section: 'career', kicker: 'Commissioner' },
};

export function trophyLabel(t: Pick<Trophy, 'trophy_key' | 'display_name'>): TrophyLabel {
  const base = TROPHY_LABELS[t.trophy_key] ?? { title: t.trophy_key.replace(/_/g, ' '), section: 'record' as const, kicker: 'Record' };
  return t.display_name ? { ...base, title: t.display_name } : base;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** The one line under a trophy's title: what the number means. */
export function trophyValueLine(t: Trophy, nameOf: (memberId: string | null | undefined) => string): string | null {
  const d = t.detail ?? {};
  const opp = typeof d.opponent_member_id === 'string' ? nameOf(d.opponent_member_id) : null;
  const when = t.season != null ? seasonLabel(t.season) : typeof d.season === 'number' ? seasonLabel(d.season) : null;
  const week = typeof d.week === 'number' ? `week ${d.week}` : null;
  const at = [when, week].filter(Boolean).join(', ');
  switch (t.trophy_key) {
    case 'champion': case 'runner_up': case 'third': case 'regular_season_title':
      return typeof d.team_name === 'string' && d.team_name ? d.team_name : null;
    case 'playoff_appearance':
      return typeof d.seed === 'number' ? `${ordinal(d.seed)} seed` : null;
    case 'toilet_bowl':
      return typeof d.team_name === 'string' && d.team_name ? d.team_name : null;
    case 'comeback_seed':
      return t.value != null ? `Won it as the ${ordinal(t.value)} seed` : null;
    case 'most_championships':
      return t.value != null ? `${t.value} ${t.value === 1 ? 'title' : 'titles'}${Array.isArray(d.seasons) ? ` (${(d.seasons as number[]).map(seasonLabel).join(', ')})` : ''}` : null;
    case 'championship_drought':
      return t.value != null ? `${t.value} ${t.value === 1 ? 'season' : 'seasons'}${d.last_title != null ? ` since ${seasonLabel(Number(d.last_title))}` : ' and counting'}` : null;
    case 'founding_member':
      return t.value != null ? `Here since ${seasonLabel(t.value)}` : null;
    case 'tenure':
      return t.value != null ? `${t.value} ${t.value === 1 ? 'season' : 'seasons'}` : null;
    case 'all_time_win_pct':
      return t.value != null ? `${pct(t.value)} (${d.wins ?? 0}-${d.losses ?? 0}${Number(d.ties) > 0 ? `-${d.ties}` : ''})` : null;
    case 'highest_week': case 'lowest_week':
      return t.value != null ? `${num(t.value)} points${opp ? ` vs ${opp}` : ''}${at ? `, ${at}` : ''}` : null;
    case 'biggest_blowout': case 'closest_game':
      return t.value != null ? `By ${num(t.value)}${opp ? ` over ${opp}` : ''}${at ? `, ${at}` : ''}` : null;
    case 'longest_win_streak': case 'longest_losing_streak':
      return t.value != null ? `${t.value} straight${d.ended_season != null ? `, ended ${seasonLabel(Number(d.ended_season))}` : ''}` : null;
    case 'category_sweep': case 'narrowest_category_win':
      return typeof d.line === 'string' ? `${d.line}${opp ? ` vs ${opp}` : ''}${at ? `, ${at}` : ''}` : null;
    case 'perfect_week':
      return typeof d.line === 'string' ? `${d.line}${week ? `, ${week}` : ''}` : null;
    case 'category_dominance':
      return typeof d.stat_key === 'string' ? `${statName(d.stat_key)}: ${t.value ?? 0} weekly wins` : null;
    case 'lifetime_h2h':
      return opp ? `${d.wins ?? 0}-${d.losses ?? 0}${Number(d.ties) > 0 ? `-${d.ties}` : ''} vs ${opp}` : null;
    case 'toughest_opponent': case 'favourite_victim':
      return opp && t.value != null ? `${pct(t.value)} vs ${opp} (${d.wins ?? 0}-${d.losses ?? 0}${Number(d.ties) > 0 ? `-${d.ties}` : ''})` : null;
    case 'custom':
      return typeof d.note === 'string' ? d.note : when;
    default:
      return t.value != null ? num(t.value) : null;
  }
}

/** 2024 -> "2024-25". Citrus stores the start year. */
export function seasonLabel(start: number): string {
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const STAT_NAMES: Record<string, string> = {
  goals: 'Goals', assists: 'Assists', points: 'Points', power_play_points: 'Power play points', short_handed_points: 'Short-handed points',
  shots_on_goal: 'Shots on goal', hits: 'Hits', blocks: 'Blocks', penalty_minutes: 'Penalty minutes', plus_minus: 'Plus/minus',
  faceoff_wins: 'Faceoff wins', game_winning_goals: 'Game-winning goals', wins: 'Wins', saves: 'Saves', shutouts: 'Shutouts',
  goals_against: 'Goals against', goals_against_average: 'Goals against average', save_percentage: 'Save percentage',
};

export function statName(key: string): string {
  return STAT_NAMES[key] ?? key.replace(/^unknown_(espn|yahoo)_/, 'Unknown stat ').replace(/_/g, ' ');
}

/** "3 titles · 11 seasons · 6 playoffs · best: 1st" */
export function careerLine(m: Pick<HistoryMember, 'titles' | 'seasons_played' | 'playoff_seasons' | 'best_finish'>): string {
  const parts: string[] = [];
  const titles = Number(m.titles ?? 0);
  if (titles > 0) parts.push(`${titles} ${titles === 1 ? 'title' : 'titles'}`);
  const seasons = Number(m.seasons_played ?? 0);
  if (seasons > 0) parts.push(`${seasons} ${seasons === 1 ? 'season' : 'seasons'}`);
  const playoffs = Number(m.playoff_seasons ?? 0);
  if (playoffs > 0) parts.push(`${playoffs} ${playoffs === 1 ? 'playoff run' : 'playoff runs'}`);
  if (m.best_finish != null && titles === 0) parts.push(`best: ${ordinal(Number(m.best_finish))}`);
  return parts.join(' · ');
}

/** The standings row for a member in a season, or null. */
export function standingFor(standings: HistoryStanding[], season: number, memberId: string | null): HistoryStanding | null {
  if (!memberId) return null;
  return standings.find((s) => s.season === season && s.member_id === memberId) ?? null;
}

/** Group live, visible trophies by section, each in a stable order. */
export function groupTrophies(trophies: Trophy[]): Record<TrophySection, Trophy[]> {
  const out: Record<TrophySection, Trophy[]> = { season: [], record: [], career: [], h2h: [] };
  for (const t of trophies) {
    if (t.is_hidden) continue;
    out[trophyLabel(t).section].push(t);
  }
  out.season.sort((a, b) => (b.season ?? 0) - (a.season ?? 0) || (a.rank ?? 99) - (b.rank ?? 99));
  const recordOrder = ['highest_week', 'biggest_blowout', 'closest_game', 'lowest_week', 'longest_win_streak', 'longest_losing_streak', 'category_sweep', 'perfect_week', 'narrowest_category_win', 'category_dominance'];
  out.record.sort((a, b) => recordOrder.indexOf(a.trophy_key) - recordOrder.indexOf(b.trophy_key));
  const careerOrder = ['most_championships', 'founding_member', 'tenure', 'all_time_win_pct', 'championship_drought', 'custom'];
  out.career.sort((a, b) => careerOrder.indexOf(a.trophy_key) - careerOrder.indexOf(b.trophy_key) || (b.value ?? 0) - (a.value ?? 0));
  return out;
}

/** member_id -> display name, with a placeholder for a row the room does not know. */
export function memberNamer(history: Pick<LeagueHistory, 'members'>) {
  const byId = new Map(history.members.map((m) => [m.member_id, m.display_name]));
  return (id: string | null | undefined) => (id ? byId.get(id) ?? 'Unknown manager' : 'Unknown manager');
}
