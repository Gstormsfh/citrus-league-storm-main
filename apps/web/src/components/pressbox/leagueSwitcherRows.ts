/**
 * THE LEAGUE SWITCHER'S ROWS (2026-09-05).
 *
 * Reported from the phone, the first morning on the Press Box chrome: "the
 * league drop down doesn't work any longer with the new visuals. Click the
 * dropdown and nothing happens; I can't create a new league." The old
 * mobile navbar's league pill WAS the switcher (My Leagues, Create / Join
 * at the top since 09-01); the Press Box header's name was a Link to the
 * HQ you were already standing on. Same tap, nothing happened.
 *
 * The rows are pure and exported on their own so the two rules that matter
 * are pinned by a test and not by three JSX callbacks: the manager's
 * leagues come back in the order the context holds them, the active one
 * marked, and the sub-line is the same rule the desktop switcher uses —
 * a pool names its game, a fantasy league names where its season stands.
 */
import { getLeagueTypeFromSettings, getPoolLabel, isPoolLeague } from '@/utils/leagueTypeHelpers';

export interface SwitcherLeague {
  id: string;
  name: string;
  settings?: unknown;
  draft_status?: string | null;
}

export interface LeagueSwitcherRow {
  id: string;
  name: string;
  /** One letter, the same fallback crest `LeagueHeader` and `LeagueMenu` draw. */
  initial: string;
  /** `SEASON ACTIVE` · `DRAFTING NOW` · `DRAFT PENDING` · `PICK'EM POOL`. */
  line: string;
  leagueType: string;
  active: boolean;
}

export function switcherLine(league: SwitcherLeague): { line: string; leagueType: string } {
  const leagueType = getLeagueTypeFromSettings((league.settings as Record<string, unknown> | null | undefined) ?? null);
  if (isPoolLeague(leagueType)) return { line: `${getPoolLabel(leagueType)} Pool`, leagueType };
  if (league.draft_status === 'completed') return { line: 'Season Active', leagueType };
  if (league.draft_status === 'in_progress') return { line: 'Drafting now', leagueType };
  return { line: 'Draft Pending', leagueType };
}

export function leagueSwitcherRows(leagues: readonly SwitcherLeague[], activeId: string | null | undefined): LeagueSwitcherRow[] {
  return leagues.map((l) => {
    const { line, leagueType } = switcherLine(l);
    return {
      id: l.id,
      name: l.name,
      initial: (l.name || '?').slice(0, 1).toUpperCase(),
      line,
      leagueType,
      active: !!activeId && l.id === activeId,
    };
  });
}
