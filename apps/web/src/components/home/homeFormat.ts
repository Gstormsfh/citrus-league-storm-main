/**
 * THE APP HOME'S ARITHMETIC (2026-09-04) — the pure half of PressBoxHome,
 * kept apart from the component so it can be tested without the API client
 * (which reaches the Supabase client at module scope).
 */
import type { ScoreboardGame, ScoresDayResponse } from '@citrus/shared';
import type { League } from '@/services/LeagueService';
import { clampToSeasonStart, getCurrentWeekNumber, getDraftCompletionDate, getFirstWeekStartDate } from '@/utils/weekCalculator';
import { rowStatusText } from '@/components/scores/scoresFormat';
import type { PressBoxTickerGame } from '@/components/pressbox/ScoreTicker';
import type { PressBoxTonightPlayer } from '@/components/pressbox/TonightCard';

/** `Head-to-Head Points` is a sentence; a 10px meta line wants `H2H PTS`. */
export const FORMAT_SHORT: Record<string, string> = {
  'h2h-points': 'H2H PTS',
  'h2h-categories': 'CATEGORIES',
  roto: 'ROTO',
  'total-points': 'SEASON PTS',
  'best-ball': 'BEST BALL',
  'points-per-game': 'PPG',
};

/**
 * `Puck Heads Dynasty` → `PH`, `Office Pick'em` → `OP`, and a one-word name
 * takes its first and last letters — `Finalsz` → `FZ`, as the artboard
 * draws it — because `FI` is the start of a word and `FZ` is a mark.
 */
export function crestOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const letters = name.replace(/[^A-Za-z0-9]/g, '');
  if (letters.length >= 2) return (letters[0] + letters[letters.length - 1]).toUpperCase();
  return letters.toUpperCase() || '?';
}

/** `3rd 4:12` while live (the artboard's order), `FINAL`, or the start time. */
function gameStatus(g: ScoreboardGame): string {
  if (g.state === 'live') return [g.period, g.periodTime].filter(Boolean).join(' ') || rowStatusText(g);
  return rowStatusText(g);
}

/** The fantasy week a league is in, or null before its draft / in the offseason. */
export function weekOf(league: League, inOffseason: boolean): number | null {
  if (inOffseason) return null;
  const done = getDraftCompletionDate(league);
  if (!done || Number.isNaN(done.getTime())) return null;
  return getCurrentWeekNumber(clampToSeasonStart(getFirstWeekStartDate(done)));
}

/** `EDM 3 · TOR 2` + `3rd 4:12`, or `COL · LAK` + `8:00 PM`. */
export function tickerGame(g: ScoreboardGame): PressBoxTickerGame {
  const played = g.state === 'live' || g.state === 'final';
  return {
    id: String(g.gameId),
    line: played
      ? `${g.away.abbrev} ${g.awayScore ?? 0} · ${g.home.abbrev} ${g.homeScore ?? 0}`
      : `${g.away.abbrev} · ${g.home.abbrev}`,
    state: gameStatus(g),
    live: g.state === 'live',
  };
}

/** The caller's players in tonight's games, best line first. */
export function tonightPlayers(day: ScoresDayResponse | undefined): { players: PressBoxTonightPlayer[]; games: number } {
  if (!day) return { players: [], games: 0 };
  const out: PressBoxTonightPlayer[] = [];
  let games = 0;
  for (const g of day.games) {
    const mine = (g.citrus?.players ?? []).filter((p) => p.roster?.isMine);
    if (mine.length === 0) continue;
    games += 1;
    const played = g.state === 'live' || g.state === 'final';
    // `EDM · 3RD` while live, `COL · 8:00` before, `MIN · FINAL` after.
    const status = g.state === 'live' ? (g.period ?? rowStatusText(g)) : rowStatusText(g);
    for (const p of mine) {
      const a = p.actuals;
      const unit = played && a
        ? p.isGoalie
          ? `${a.saves ?? 0} SV`
          : [a.goals ? `${a.goals}G` : null, a.assists ? `${a.assists}A` : null].filter(Boolean).join(' ') || `${a.shotsOnGoal} SOG`
        : 'PROJ';
      out.push({
        id: String(p.playerId),
        gameLine: `${p.teamAbbrev ?? g.home.abbrev} · ${status}`.toUpperCase(),
        name: p.name.split(/\s+/).slice(-1)[0],
        points: played && p.actualPoints != null ? p.actualPoints : p.projectedPoints,
        unit,
        played: played && p.actualPoints != null,
      });
    }
  }
  out.sort((x, y) => (y.points ?? -1) - (x.points ?? -1));
  return { players: out, games };
}

