// T12 architect Entry 13 (2026-08-09) — LEAGUE TIMELINE CARD render.
//
// Sleeper-gap 2 ("the league that convenes"). Consumes the pure
// assembleLeagueTimeline() function from @citrus/shared and renders
// a citrus2-styled read-only feed card on the league home page.
//
// Data sources (all pre-existing endpoints — no new endpoints):
//   - draft: derived from `league.draft_status === 'completed'` +
//     draftHistory (first pick of round 1 = top pick).
//   - transactions: leagueApi.getTransactions(leagueId) → processed
//     rows from transaction_ledger (WaiverService.ts:540/630 writes).
//   - matchups: matchupApi.getLeagueMatchups(leagueId) → most recent
//     completed matchups. Filtered client-side to `status='completed'`
//     (or equivalent) rows.
//
// Empty state: renders the scene-league-quiet.webp composition slot
// (art brief pending in docs/ART_GENERATION_QUEUE.md; falls back to
// mascot-stormy.webp until the bespoke render lands).
//
// 10-item cap enforced by pure assembly function.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  assembleLeagueTimeline,
  type DraftCompletionInput,
  type TransactionInput,
  type MatchupResultInput,
  type TimelineItem,
} from '@citrus/shared';
import { leagueApi } from '@/api/leagues';
import { matchupApi } from '@/api/matchups';
import { PlayerService } from '@/services/PlayerService';
import { CitrusCard, CitrusCardEyebrow, CitrusCardTitle } from '@/components/citrus2/CitrusCard';
import { logger } from '@/utils/logger';

// ── Prop + row types (from existing endpoint responses) ────────────

export interface LeagueTimelineCardProps {
  leagueId: string;
  /** From league record (already fetched by parent). */
  draftStatus?: string | null;
  /** From league record — used as the "when" for draft_completed. */
  draftCompletedAt?: string | null;
  /**
   * Optional pre-resolved top pick (round 1, pick 1). Parent may
   * pass this in if it already fetched draftHistory; otherwise
   * this card only shows "Rosters are set" as the sub text.
   */
  topPick?: { playerName: string; teamName: string } | null;
}

// Shape returned by leagueApi.getTransactions (LeagueService.fetchTransactions).
interface LedgerRowFromApi {
  type?: string;
  transaction_type?: string; // legacy alias
  player_id?: string | number;
  player_name?: string;
  teams?: { team_name?: string } | null;
  team_name?: string;
  created_at?: string;
  status?: string;
}

// Shape returned by matchupApi.getLeagueMatchups.
interface MatchupRowFromApi {
  week?: number;
  home_team_name?: string;
  away_team_name?: string;
  home_score?: number;
  away_score?: number;
  status?: string;
  completed_at?: string;
  updated_at?: string;
}

// ── Row → input adapters (client-only, per-endpoint shape) ─────────

function toTransactionInputs(
  rows: LedgerRowFromApi[],
  playerNameById: Map<string, string>,
): TransactionInput[] {
  const out: TransactionInput[] = [];
  for (const r of rows) {
    if (r.status && r.status !== 'processed') continue; // pending/failed excluded
    const rawType = (r.type ?? r.transaction_type ?? '').toUpperCase();
    if (rawType !== 'ADD' && rawType !== 'DROP') continue;
    // NAME FIX (2026-08-22, found live on prod during launch QA): the ledger
    // endpoint returns player_id only — rendering "Player #8484801" on the
    // league home page. Resolve through the same player directory the
    // Roster Transactions tab uses; fall back to a neutral phrase, never a
    // raw id.
    const playerName =
      r.player_name
      ?? (r.player_id != null ? playerNameById.get(String(r.player_id)) : undefined)
      ?? 'a player';
    const teamName = r.teams?.team_name ?? r.team_name ?? 'Unknown team';
    const createdAt = r.created_at;
    if (!createdAt) continue;
    out.push({ type: rawType as 'ADD' | 'DROP', playerName, teamName, createdAt });
  }
  return out;
}

function toMatchupInputs(rows: MatchupRowFromApi[]): MatchupResultInput[] {
  const out: MatchupResultInput[] = [];
  for (const r of rows) {
    if (r.status && r.status !== 'completed') continue;
    if (typeof r.home_score !== 'number' || typeof r.away_score !== 'number') continue;
    if (!r.home_team_name || !r.away_team_name || typeof r.week !== 'number') continue;
    const when = r.completed_at ?? r.updated_at;
    if (!when) continue;
    out.push({
      week: r.week,
      homeTeamName: r.home_team_name,
      awayTeamName: r.away_team_name,
      homeScore: r.home_score,
      awayScore: r.away_score,
      completedAt: when,
    });
  }
  return out;
}

// ── Item icon selector (kind → emoji glyph) ────────────────────────

const KIND_GLYPH: Record<TimelineItem['kind'], string> = {
  draft_completed: '⭐',
  transaction_add: '＋',
  transaction_drop: '－',
  matchup_result: '🏒',
};

function formatRelativeWhen(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = Math.max(0, now.getTime() - then.getTime());
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  return `${Math.floor(diffMon / 12)}y ago`;
}

// ── The card ───────────────────────────────────────────────────────

export function LeagueTimelineCard({
  leagueId,
  draftStatus,
  draftCompletedAt,
  topPick,
}: LeagueTimelineCardProps) {
  // Fetch existing endpoints in parallel via React Query.
  const transactionsQuery = useQuery({
    queryKey: ['league-timeline-transactions', leagueId],
    queryFn: async () => {
      const res = await leagueApi.getTransactions(leagueId);
      // apiClient wraps in { data, error } but some helpers unwrap.
      // Be defensive: accept either shape.
      const raw = (res as { data?: unknown; transactions?: unknown }).data
        ?? (res as { transactions?: unknown }).transactions
        ?? res;
      const rows = Array.isArray(raw)
        ? (raw as LedgerRowFromApi[])
        : Array.isArray((raw as { transactions?: unknown })?.transactions)
          ? ((raw as { transactions: LedgerRowFromApi[] }).transactions)
          : [];
      return rows;
    },
    staleTime: 60_000,
    enabled: !!leagueId,
  });

  const matchupsQuery = useQuery({
    queryKey: ['league-timeline-matchups', leagueId],
    queryFn: async () => {
      try {
        const res = await matchupApi.getLeagueMatchups(leagueId);
        const raw = (res as { data?: unknown; matchups?: unknown }).data
          ?? (res as { matchups?: unknown }).matchups
          ?? res;
        return Array.isArray(raw) ? (raw as MatchupRowFromApi[]) : [];
      } catch (err) {
        // Matchup endpoint may be offseason-empty; treat as empty
        // rather than surfacing an error banner (Sleeper-style calm).
        logger.warn('[LeagueTimelineCard] matchups fetch failed, treating as empty', err);
        return [];
      }
    },
    staleTime: 60_000,
    enabled: !!leagueId,
  });

  // Player directory for id → name resolution (same source as the Roster
  // Transactions tab; PlayerService caches, so this is cheap after first load).
  const playersQuery = useQuery({
    queryKey: ['league-timeline-players'],
    queryFn: async () => {
      try {
        const players = await PlayerService.getAllPlayers();
        return new Map(players.map((p) => [String(p.id), p.full_name]));
      } catch (err) {
        logger.warn('[LeagueTimelineCard] player directory fetch failed; names fall back', err);
        return new Map<string, string>();
      }
    },
    staleTime: 10 * 60_000,
  });

  const items: TimelineItem[] = useMemo(() => {
    const draft: DraftCompletionInput | null =
      draftStatus === 'completed' && draftCompletedAt
        ? { completedAt: draftCompletedAt, topPick: topPick ?? null }
        : null;
    const transactions = toTransactionInputs(
      transactionsQuery.data ?? [],
      playersQuery.data ?? new Map(),
    );
    const matchups = toMatchupInputs(matchupsQuery.data ?? []);
    return assembleLeagueTimeline({ draft, transactions, matchups });
  }, [draftStatus, draftCompletedAt, topPick, transactionsQuery.data, matchupsQuery.data, playersQuery.data]);

  const isLoading = transactionsQuery.isLoading || matchupsQuery.isLoading;

  return (
    <CitrusCard accent="mono" padding="default">
      <CitrusCardEyebrow>Timeline</CitrusCardEyebrow>
      <CitrusCardTitle size="sm">The league, lately</CitrusCardTitle>

      {isLoading ? (
        <div className="mt-4 text-sm text-white/55">Loading…</div>
      ) : items.length === 0 ? (
        <div className="mt-4 flex flex-col items-center text-center gap-3 py-4">
          {/* Empty-state art slot. Uses mascot-stormy.webp until the
              bespoke scene-league-quiet.webp lands per
              docs/ART_GENERATION_QUEUE.md T12 brief. */}
          <img
            src="/mascots/mascot-stormy.webp"
            alt=""
            aria-hidden="true"
            className="w-20 h-20 object-contain opacity-80"
            data-timeline-empty-slot="scene-league-quiet"
          />
          <div className="text-sm text-white/55">
            Quiet on the ice. New moments will appear here as the league gets going.
          </div>
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {items.map((item, i) => (
            <li
              key={`${item.kind}:${item.when}:${i}`}
              className="flex items-start gap-3 px-3 py-2 rounded-xl bg-white/[0.03] ring-1 ring-white/5 hover:bg-white/[0.06] transition-colors"
            >
              <span
                className="w-7 h-7 rounded-lg bg-pastel-orange/10 ring-1 ring-pastel-orange/20 flex items-center justify-center text-sm shrink-0 select-none"
                aria-hidden="true"
              >
                {KIND_GLYPH[item.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-pastel-cream font-medium leading-snug">
                  {item.headline}
                </div>
                <div className="text-xs text-white/55 mt-0.5">
                  <span>{item.sub}</span>
                  <span className="mx-1.5">·</span>
                  <span>{formatRelativeWhen(item.when)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </CitrusCard>
  );
}
