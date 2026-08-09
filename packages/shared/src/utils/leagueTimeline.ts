// T12 architect Entry 13 (2026-08-09) — LEAGUE TIMELINE CARD, Sleeper-
// gap 2 ("the league that convenes"). Pure feed-assembly function.
//
// PURPOSE
//   Read-only feed card on league home. Assembles moments from data
//   already recorded (no new tables, no new endpoints) into a
//   chronological "what's been happening" feed the manager sees when
//   they land on the league page. Sleeper-style calm activity ledger.
//
// SCOPE (Entry 13 verbatim)
//   Sources:
//     1. Draft completed — with top pick (first pick of round 1).
//     2. Recent ADD / DROP transactions from `transaction_ledger`.
//     3. Latest matchup result if in-season.
//
//   Output:
//     - Newest-first.
//     - 10-item cap.
//     - Empty-state signaled by empty array (component renders the
//       scene composition slot per architect brief).
//
// DESIGN NOTES
//   - Pure function: (raw rows in) → (timeline items out). No I/O,
//     no clock reads inside the function, no side effects.
//   - Callers pass the raw rows from existing endpoints. No new
//     endpoint required.
//   - `null`-safe throughout: missing fields render minimal
//     text and never throw.
//   - KI-042 discipline: player_id domain not touched by this
//     function; input types carry pre-resolved `playerName` strings.
//     Consumers do the id→name lookup upstream.
//
// See docs/TERMINAL_OUTBOX.md R24 for the T12 authoring narrative.

// ── Input types (shape of what upstream endpoints return) ─────────

export interface DraftCompletionInput {
  /** ISO timestamp when draft completed, or null if not yet completed. */
  completedAt: string | null;
  /**
   * The first pick of round 1 (draft's headline moment). Optional
   * because the top-pick data may not be resolved at read time on
   * every code path (e.g., initial page load before pick data lands).
   */
  topPick?: {
    playerName: string;
    /** Team that made the pick. */
    teamName: string;
  } | null;
}

export interface TransactionInput {
  /** 'ADD' or 'DROP' — matches WaiverService.ts:540/630 ledger writes. */
  type: 'ADD' | 'DROP';
  /** Display name for the player (resolved upstream). */
  playerName: string;
  /** Display name for the team that added/dropped. */
  teamName: string;
  /** ISO timestamp — the `created_at` column of transaction_ledger. */
  createdAt: string;
}

export interface MatchupResultInput {
  week: number;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  /** ISO timestamp when the matchup was finalized. */
  completedAt: string;
}

export interface AssembleTimelineInput {
  draft: DraftCompletionInput | null;
  transactions: readonly TransactionInput[];
  matchups: readonly MatchupResultInput[];
}

// ── Output type (what the card renders) ───────────────────────────

export type TimelineItemKind =
  | 'draft_completed'
  | 'transaction_add'
  | 'transaction_drop'
  | 'matchup_result';

export interface TimelineItem {
  /** Discriminator for icon + treatment choice in the card. */
  kind: TimelineItemKind;
  /** ISO timestamp — canonicalized for chronological sort. */
  when: string;
  /** One-line primary label. */
  headline: string;
  /** Secondary line — context, score, team name, etc. */
  sub: string;
}

// ── Constants ─────────────────────────────────────────────────────

/**
 * Cap for the number of items in the assembled feed. Per architect
 * Entry 13: 10-item cap.
 */
export const LEAGUE_TIMELINE_CAP = 10;

// ── The pure assembly function ────────────────────────────────────

/**
 * Assemble a chronological, capped feed of league moments.
 *
 * Ordering: newest-first by `when` (ISO string compare is stable and
 * correct for ISO-8601 timestamps in UTC or with offset). Items with
 * identical timestamps keep source order (JS sort is stable in modern
 * engines).
 *
 * Cap: LEAGUE_TIMELINE_CAP applied AFTER sort. Older items past the
 * cap are silently dropped; the card is not paginated (Sleeper-style
 * calm feed).
 *
 * Empty input: returns []. The card renders the scene composition
 * slot for that case (see LeagueTimelineCard.tsx).
 */
export function assembleLeagueTimeline(
  input: AssembleTimelineInput,
): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Draft completion moment (at most one, if completedAt present).
  if (input.draft?.completedAt) {
    const topPickText =
      input.draft.topPick
        ? `${input.draft.topPick.teamName} took ${input.draft.topPick.playerName} #1 overall`
        : 'Rosters are set';
    items.push({
      kind: 'draft_completed',
      when: input.draft.completedAt,
      headline: 'Draft complete',
      sub: topPickText,
    });
  }

  // Transactions — one item per ledger row.
  for (const t of input.transactions) {
    if (t.type === 'ADD') {
      items.push({
        kind: 'transaction_add',
        when: t.createdAt,
        headline: `${t.teamName} added ${t.playerName}`,
        sub: 'Free agent pickup',
      });
    } else if (t.type === 'DROP') {
      items.push({
        kind: 'transaction_drop',
        when: t.createdAt,
        headline: `${t.teamName} dropped ${t.playerName}`,
        sub: 'Roster move',
      });
    }
    // Other type values are silently ignored — new ledger types
    // (TRADE, IR, etc.) get their own explicit cases later.
  }

  // Matchup results.
  for (const m of input.matchups) {
    const winner =
      m.homeScore > m.awayScore ? m.homeTeamName
      : m.awayScore > m.homeScore ? m.awayTeamName
      : null;
    const loser =
      m.homeScore > m.awayScore ? m.awayTeamName
      : m.awayScore > m.homeScore ? m.homeTeamName
      : null;
    const winScore = Math.max(m.homeScore, m.awayScore);
    const loseScore = Math.min(m.homeScore, m.awayScore);
    const headline =
      winner
        ? `${winner} beat ${loser}, ${winScore}–${loseScore}`
        : `${m.homeTeamName} tied ${m.awayTeamName}, ${m.homeScore}–${m.awayScore}`;
    items.push({
      kind: 'matchup_result',
      when: m.completedAt,
      headline,
      sub: `Week ${m.week}`,
    });
  }

  // Sort newest-first, then cap.
  items.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  return items.slice(0, LEAGUE_TIMELINE_CAP);
}
