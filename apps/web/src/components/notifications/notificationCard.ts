/**
 * A `notifications` row -> the card the toaster paints. The pure half of the
 * realtime bridge (`useNotificationCards.ts` is the hook that fires it).
 *
 * WHY THIS EXISTS (2026-09-03). The Sleeper-shape status card shipped on
 * 2026-09-02 (CitrusToaster.tsx, `kind: 'player'`) and NOTHING FIRED IT:
 * zero call sites passed `kind: 'player'` or `kind: 'move'`, so the one
 * surface that closes the named Citrus-vs-Sleeper notification gap was
 * reachable only from a test. Meanwhile the notification store had been
 * receiving realtime rows the whole time (Navbar.tsx subscribes for the
 * active league) and painting them nowhere but the matchup page's rail.
 *
 * WHAT THE STORE ACTUALLY CARRIES, read from the writers rather than from
 * the client's type union (which says ADD | DROP | WAIVER | TRADE | CHAT |
 * SYSTEM and is narrower than what the server writes):
 *
 *   ADD / DROP / TRADE  the ledger trigger `notify_league_on_transaction`
 *                       (supabase/migrations/20260823013000_*.sql). metadata
 *                       = { team_id, team_name, player_id, player_name,
 *                       source }. ADD with source 'Waiver Processing' is a
 *                       claim that cleared; any other ADD is a free-agent
 *                       pickup. TRADE fires once per player acquired.
 *                       These are the rows that carry a player, and the
 *                       only ones that get the face.
 *   CHAT                `send_league_chat_message`: title "<sender> sent a
 *                       message", metadata { sender_id, sender_name }; the
 *                       sender's own copy is inserted already read.
 *   SYSTEM              `notify_league_members`: a title and a message, no
 *                       metadata worth reading.
 *   waiver_result /     written by scheduled.ts and TradeService.ts since
 *   trade_offer         2026-08-16. NOTE the repo's check constraint on
 *                       notifications.type does not admit either value
 *                       (20251212180000_create_notifications_table.sql:6),
 *                       so whether they ever reach a client depends on prod
 *                       having been altered outside the migrations. Mapped
 *                       defensively to the plain shape; never assumed.
 *
 * The rich card needs BOTH a numeric player_id and a player_name. The id is
 * what the face is enriched from (PlayerService, by id) and the name is the
 * headline and the initials fallback; a row with either missing renders the
 * plain shape, which is the shape every existing toast already has.
 *
 * Pure, no JSX, no React: a `.ts` sibling for the reason notificationKind.ts
 * gives (react-refresh), and so the mapping can be pinned row-by-row without
 * a Radix provider.
 */
import type { Notification } from '@/services/NotificationService';
import type { MugPlayer } from '@/components/roster/headshot';
import type { NotificationKind, ToastStatus } from './notificationKind';

/** What the toaster is handed: the `toast()` payload, minus the id it mints. */
export interface NotificationCard {
  kind: NotificationKind;
  title: string;
  description?: string;
  meta?: string;
  status?: ToastStatus;
  at?: number;
  player?: MugPlayer;
}

/**
 * The pill vocabulary: every state a status card can wear, named once.
 *
 * Labels are STATES, not verdicts (COPY_VOICE: "a STATE, not a verdict"),
 * two words at most, rendered uppercase by STATUS_PILL_BASE. Tones follow
 * the identity-vs-standing rule the matchup header states
 * (StickyScoreBar.tsx: orange is YOU / act, sage is good / ahead): a state
 * that went the reader's way is `good`, one that needs the reader's hand is
 * `attention`, a loss is `bad`, and a plain fact is `neutral`.
 *
 * Only the first four have an emitter today (the ledger trigger above). The
 * rest are here so the label and the tone are decided ONCE, before the
 * emitter exists: `lineupLocked` belongs to LineupService's lock sweep,
 * `draftPick` to the draft engine's pick event, `injury` to a roster-status
 * feed, `claimMissed` / `tradeOffer` to the two constrained writers noted in
 * the header. A future caller names the key; nobody re-decides the colour.
 */
export type StatusPillKey =
  | 'waiverCleared'
  | 'added'
  | 'dropped'
  | 'tradeAccepted'
  | 'tradeOffer'
  | 'claimMissed'
  | 'lineupLocked'
  | 'draftPick'
  | 'injury';

export const STATUS_PILLS: Record<StatusPillKey, ToastStatus> = {
  waiverCleared: { label: 'Waiver cleared', tone: 'good' },
  added: { label: 'Added', tone: 'good' },
  dropped: { label: 'Dropped', tone: 'neutral' },
  tradeAccepted: { label: 'Trade accepted', tone: 'good' },
  tradeOffer: { label: 'Trade offer', tone: 'attention' },
  claimMissed: { label: 'Claim missed', tone: 'bad' },
  lineupLocked: { label: 'Lineup locked', tone: 'neutral' },
  draftPick: { label: 'Draft pick', tone: 'neutral' },
  injury: { label: 'Injury', tone: 'attention' },
};

/** The source string the ledger trigger writes on a claim that cleared. */
export const WAIVER_SOURCE = 'Waiver Processing';

/**
 * The player id a row carries, or null. Digits only: the trigger casts
 * `player_id::INT` to look the name up (20260823013000_*.sql:51), so digits
 * is the contract, and a value that is not one cannot be enriched and must
 * not grow a face. Both the text form (the ledger) and the numeric form
 * (waiver_claims) arrive here.
 */
export function playerIdOf(n: Pick<Notification, 'metadata'>): string | null {
  const raw = n.metadata?.player_id;
  if (raw == null) return null;
  const id = String(raw).trim();
  return /^\d+$/.test(id) ? id : null;
}

/** `created_at` as epoch ms, or undefined when it does not parse. */
export function arrivedAt(n: Pick<Notification, 'created_at'>): number | undefined {
  const t = Date.parse(n.created_at);
  return Number.isFinite(t) ? t : undefined;
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
};

/**
 * The meta line of a rich card: the ACTOR (the fantasy team), then what
 * happened, one line. The trigger already coalesces a missing team name to
 * "A team", so the fallback here is the unadorned verb rather than a second
 * placeholder.
 */
function richMeta(team: string | null, what: string): string {
  return team ? `${team} · ${what}` : what;
}

/**
 * Row -> card. Never throws: a row with an odd shape becomes a plain info
 * card carrying the server's own title and message, which is what the
 * matchup rail shows for the same row.
 */
export function toastFromNotification(n: Notification): NotificationCard {
  // Widened on purpose. The union on Notification['type'] is narrower than
  // the server's writers (see the header), and comparing a union member to
  // a string outside it is a TypeScript error rather than a false branch.
  const type: string = n.type;
  const meta = n.metadata ?? {};
  const at = arrivedAt(n);
  const playerId = playerIdOf(n);
  const playerName = text(meta.player_name);
  const team = text(meta.team_name);

  if (playerId && playerName && (type === 'ADD' || type === 'DROP' || type === 'TRADE')) {
    const status =
      type === 'ADD'
        ? meta.source === WAIVER_SOURCE
          ? STATUS_PILLS.waiverCleared
          : STATUS_PILLS.added
        : type === 'DROP'
          ? STATUS_PILLS.dropped
          : STATUS_PILLS.tradeAccepted;
    const what =
      type === 'ADD'
        ? meta.source === WAIVER_SOURCE
          ? 'claim awarded'
          : 'free agent pickup'
        : type === 'DROP'
          ? 'released'
          : 'acquired by trade';
    return {
      kind: 'player',
      title: playerName,
      meta: richMeta(team, what),
      status,
      at,
      // The face starts as initials on the forest disc (Mug's last fallback)
      // and is enriched by id once the directory answers; see the hook.
      player: { name: playerName },
    };
  }

  if (type === 'CHAT') {
    // Name the actor. The row's own title is "<sender> sent a message"; the
    // sender alone is the headline and the message is the body.
    return {
      kind: 'info',
      title: text(meta.sender_name) ?? n.title,
      description: n.message,
      at,
    };
  }

  if (type === 'waiver_result') {
    const won = meta.status === 'successful';
    return { kind: won ? 'success' : 'warning', title: n.title, description: n.message, at };
  }

  return { kind: 'info', title: n.title, description: n.message, at };
}
