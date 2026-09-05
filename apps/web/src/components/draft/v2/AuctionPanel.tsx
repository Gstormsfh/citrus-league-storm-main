// Auction room panel (2026-08-24 launch build; Press Box 2026-09-05).
//
// Renders the live auction surface for `format === 'auction'` lobbies:
// the lot on the block (face, name, leading bid + bidder, the clock), the
// bid controls, the nominate flow for the on-clock nominator, the budget
// strip and the results feed. State comes exclusively from
// `useAuctionDerived` (seeded from the engine snapshot, folded from live
// WS events — see deriveAuctionState.ts); actions go out over the draft-v2
// auction HTTP routes and confirm back through the event stream.
//
// PRESS BOX (2026-09-05, from the first live auction on the phone): the
// panel wore the launch build's shadcn Card / Button / Input — grey pills
// in the marketing face, a wall of twelve budget pills one per line, and a
// results feed that named the buyer and the price but not the player.
// Now: one tile for the lot with the clock large and the bid the primary
// orange action, budgets as one scrolling strip with YOU first, results as
// rows with the face and the name. Every figure is what the derived state
// holds; nothing here invents a number.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Gavel, Search, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useAuctionDerived, useDraftMatrix } from '@/stores/draftClientStore';
import { submitBid, submitNomination } from '@/lib/draftClient/submitAuctionAction';
import type { Player } from '@/services/PlayerService';
import type { FetchedTeam } from '@/lib/draftClient/v1Adapters';
import { Mug } from '@/components/roster/Mug';
import { mugFromDirectory } from '@/components/roster/headshot';
import { positionChipKey } from '@/components/roster/positionChip';
import { pressBoxPositionChipClasses } from '@/components/pressbox/positionChip';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { getTeamColor } from '@/utils/teamColors';
import { DEFAULT_TIERS, minimumNextBid, type BidIncrementTier } from '@/lib/draftClient/auctionRules';

interface AuctionPanelProps {
  leagueId: string;
  teams: FetchedTeam[];
  playersById: ReadonlyMap<string, Player>;
  myTeamId: string | null;
  /**
   * The league's money rules (auctionRules.ts, 2026-09-05): the floor for an
   * opening bid and the per-slot reserve, and the increment tiers the engine
   * enforces. Defaults are the engine's own ($1, flat $1).
   */
  minBid?: number;
  bidIncrementTiers?: ReadonlyArray<BidIncrementTier>;
}

const EYEBROW = 'font-plex font-semibold text-[9px] tracking-[0.14em] uppercase';
const PRIMARY =
  'focus-citrus h-11 rounded-[12px] bg-pressbox-orange text-pressbox-orange-ink font-plex font-semibold text-[12px] tracking-[0.08em] uppercase disabled:opacity-40 disabled:cursor-default';
const SECONDARY =
  'focus-citrus h-11 rounded-[12px] bg-pressbox-tile-high border border-white/[0.08] text-pressbox-text font-plex font-semibold text-[12px] tracking-[0.08em] uppercase disabled:opacity-40 disabled:cursor-default';
const FIELD =
  'h-11 rounded-[10px] bg-white/[0.04] border border-white/[0.1] font-plex font-semibold text-[16px] tabular-nums text-pressbox-text placeholder:text-pressbox-text/35 outline-none focus-citrus [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/** Live countdown to an ISO deadline; re-renders 4×/s. */
function useCountdownSeconds(deadlineIso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineIso === null) return;
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, [deadlineIso]);
  if (deadlineIso === null) return null;
  const remaining = Math.max(0, (new Date(deadlineIso).getTime() - now) / 1000);
  return Math.ceil(remaining);
}

export function AuctionPanel({
  leagueId,
  teams,
  playersById,
  myTeamId,
  minBid = 1,
  bidIncrementTiers = DEFAULT_TIERS,
}: AuctionPanelProps) {
  const auction = useAuctionDerived();
  const matrix = useDraftMatrix();
  const { toast } = useToast();

  const [bidInput, setBidInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [nomSearch, setNomSearch] = useState('');
  const [nomPlayer, setNomPlayer] = useState<Player | null>(null);
  const [nomOpeningBid, setNomOpeningBid] = useState<string>(String(minBid));
  const lastNominationId = useRef<string | null>(null);

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.team_name);
    return m;
  }, [teams]);

  // Nomination rotation = draft_order round 1 (same source the engine
  // and the server route use). Falls back to team list order when the
  // matrix hasn't landed (display-only — the server enforces).
  const rotation = useMemo(() => {
    if (matrix && matrix.length > 0) {
      return matrix.filter((s) => s.round === 1).map((s) => s.teamId);
    }
    return teams.map((t) => t.id);
  }, [matrix, teams]);

  // YOU first on the budget strip, then the room in its list order.
  const orderedTeams = useMemo(() => {
    if (!myTeamId) return teams;
    const mine = teams.filter((t) => t.id === myTeamId);
    return [...mine, ...teams.filter((t) => t.id !== myTeamId)];
  }, [teams, myTeamId]);

  const nomination = auction?.currentNomination ?? null;
  const countdown = useCountdownSeconds(nomination ? nomination.deadline : null);

  // Reset the bid input whenever a new nomination opens.
  useEffect(() => {
    const id = nomination?.nominationId ?? null;
    if (id !== lastNominationId.current) {
      lastNominationId.current = id;
      setBidInput('');
    }
  }, [nomination?.nominationId]);

  if (auction === null) return null;

  const onClockNominatorId =
    rotation.length > 0 ? rotation[auction.nominationsCompleted % rotation.length] : null;
  const iAmNominating = nomination === null && myTeamId !== null && onClockNominatorId === myTeamId;

  const myBudget = myTeamId ? auction.budgets.get(myTeamId) : undefined;
  const minNextBid = nomination ? minimumNextBid(Math.floor(nomination.leadingBid), bidIncrementTiers) : minBid;
  const myMaxAffordable = myBudget
    ? myBudget.remaining - Math.max(0, myBudget.slotsRemaining - 1) * minBid
    : null;

  const lotPlayer = nomination ? playersById.get(nomination.playerId) ?? null : null;
  const resolvedNomPlayerName =
    nomination === null ? '' : nomination.playerName || lotPlayer?.full_name || `#${nomination.playerId}`;

  const iAmLeading = nomination !== null && myTeamId !== null && nomination.leadingBidderId === myTeamId;
  const customValue = Math.floor(Number(bidInput));
  const customValid =
    bidInput.trim() !== '' &&
    Number.isFinite(customValue) &&
    customValue >= minNextBid &&
    (myMaxAffordable === null || customValue <= myMaxAffordable);
  const quickDisabled =
    submitting || iAmLeading || (myMaxAffordable !== null && minNextBid > myMaxAffordable);

  const handleBid = async (amount: number) => {
    if (!myTeamId || !nomination || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitBid({
        leagueId,
        teamId: myTeamId,
        nominationId: nomination.nominationId,
        bidAmount: amount,
      });
      if (result.ok === false) {
        toast({ title: 'Bid Not Placed', description: result.message, variant: 'destructive' });
      } else {
        setBidInput('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleNominate = async () => {
    if (!myTeamId || !nomPlayer || submitting) return;
    const opening = Math.max(minBid, Math.floor(Number(nomOpeningBid) || minBid));
    setSubmitting(true);
    try {
      const result = await submitNomination({
        leagueId,
        teamId: myTeamId,
        playerId: String(nomPlayer.id),
        playerName: nomPlayer.full_name,
        openingBid: opening,
      });
      if (result.ok === true) {
        setNomPlayer(null);
        setNomSearch('');
        setNomOpeningBid(String(minBid));
      } else {
        toast({ title: 'Nomination Failed', description: result.message, variant: 'destructive' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const nomMatches: Player[] =
    iAmNominating && nomSearch.trim().length >= 2
      ? Array.from(playersById.values())
          .filter(
            (p) =>
              p.full_name.toLowerCase().includes(nomSearch.trim().toLowerCase()) &&
              !auction.wonPlayerIds.has(String(p.id)),
          )
          .slice(0, 6)
      : [];

  const soldCount = auction.history.filter((h) => h.kind === 'won').length;
  const urgent = countdown !== null && countdown <= 5;

  return (
    <div className={cn(PB_TYPE, 'space-y-3')} data-testid="auction-panel">
      {/* ── The lot on the block ───────────────────────────────── */}
      {nomination !== null ? (
        <section
          className={cn(
            'rounded-[14px] bg-pressbox-tile border overflow-hidden',
            iAmLeading ? 'border-pressbox-orange/60' : 'border-pressbox-orange/30',
          )}
        >
          <div className="flex items-center justify-between gap-3 px-3.5 pt-3">
            <div className={cn(EYEBROW, 'flex items-center gap-2 text-pressbox-orange-soft')}>
              <Gavel className="w-3.5 h-3.5" aria-hidden="true" />
              On the block
              {nomination.isAutoNominated && (
                <span className="px-1.5 py-0.5 rounded-[4px] bg-white/10 text-pressbox-text/70 tracking-[0.08em]">Auto</span>
              )}
              {auction.paused && (
                <span className="px-1.5 py-0.5 rounded-[4px] bg-pressbox-grapefruit/15 text-pressbox-grapefruit-text tracking-[0.08em]">
                  Paused
                </span>
              )}
            </div>
            <div
              className={cn(
                'flex items-center gap-1.5 font-condensed font-extrabold text-[30px] leading-none tabular-nums',
                urgent ? 'text-pressbox-grapefruit-text' : 'text-pressbox-text',
              )}
              data-testid="auction-countdown"
              aria-live="off"
            >
              <Timer className={cn('w-[18px] h-[18px]', urgent ? 'text-pressbox-grapefruit-text' : 'text-pressbox-orange')} aria-hidden="true" />
              {countdown !== null ? `${countdown}s` : '-'}
            </div>
          </div>

          <div className="flex items-center gap-3 px-3.5 pt-2.5">
            <span
              className="w-12 h-12 flex-none rounded-full overflow-hidden ring-2 ring-white/10 bg-pressbox-tile-high"
              style={lotPlayer?.team ? { boxShadow: `0 0 0 2px ${getTeamColor(lotPlayer.team)}` } : undefined}
            >
              <Mug
                p={lotPlayer ? mugFromDirectory(lotPlayer) : { name: resolvedNomPlayerName, image: null, team: null }}
                size="md"
                className="w-full h-full"
              />
            </span>
            <div className="min-w-0 flex-1">
              <div
                className="font-condensed font-extrabold text-[24px] leading-none uppercase tracking-[0.02em] text-pressbox-text truncate"
                data-testid="auction-player"
              >
                {resolvedNomPlayerName}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 font-plex text-[10px] text-pressbox-text/55">
                {lotPlayer && (
                  <span className={cn(pressBoxPositionChipClasses(positionChipKey(lotPlayer.position)), 'text-[9px]')}>
                    {lotPlayer.position}
                  </span>
                )}
                {lotPlayer?.team && <span>{lotPlayer.team}</span>}
                <span className={cn(lotPlayer && 'before:content-["·"] before:mr-1.5')}>
                  nom. {teamNameById.get(nomination.nominatorTeamId) ?? '-'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-baseline gap-2 px-3.5 pt-3">
            <span className={cn(EYEBROW, 'text-pressbox-text/45')}>Leading</span>
            <span className="font-plex font-semibold text-[22px] leading-none tabular-nums text-pressbox-text">
              ${nomination.leadingBid}
            </span>
            <span
              className={cn(
                'font-barlow font-semibold text-[13px] truncate',
                iAmLeading ? 'text-pressbox-orange-soft' : 'text-pressbox-text/80',
              )}
            >
              {iAmLeading ? 'you' : teamNameById.get(nomination.leadingBidderId) ?? 'Unknown team'}
            </span>
          </div>

          {myTeamId !== null && !auction.paused ? (
            <div className="px-3.5 pt-3 pb-3.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={cn(PRIMARY, 'flex-1 min-w-0 truncate', iAmLeading && 'bg-pressbox-sage text-pressbox-surface')}
                  disabled={quickDisabled}
                  onClick={() => handleBid(minNextBid)}
                  data-testid="auction-quick-bid"
                >
                  {iAmLeading ? `You lead · $${nomination.leadingBid}` : `Bid $${minNextBid}`}
                </button>
                <label className="flex-none">
                  <span className="sr-only">Custom bid</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={minNextBid}
                    step={1}
                    value={bidInput}
                    onChange={(e) => setBidInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customValid && !submitting && !iAmLeading) handleBid(customValue);
                    }}
                    placeholder={`${minNextBid}`}
                    className={cn(FIELD, 'w-[76px] text-center')}
                    data-testid="auction-bid-input"
                  />
                </label>
                <button
                  type="button"
                  className={cn(SECONDARY, 'flex-none px-3.5')}
                  disabled={submitting || iAmLeading || !customValid}
                  onClick={() => handleBid(customValue)}
                >
                  Bid
                </button>
              </div>
              <div className={cn(EYEBROW, 'mt-2 flex items-center justify-between text-pressbox-text/45')}>
                <span className={cn(iAmLeading && 'text-pressbox-sage')}>
                  {iAmLeading ? 'You lead this lot' : `Min $${minNextBid}`}
                </span>
                {myBudget && myMaxAffordable !== null && (
                  <span className="tabular-nums">
                    Max ${Math.max(0, myMaxAffordable)} · {myBudget.slotsRemaining} slots
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="pb-3.5" />
          )}
        </section>
      ) : (
        <section className="rounded-[14px] bg-pressbox-tile border border-white/[0.08] px-3.5 py-3">
          <div className="flex items-center gap-2">
            <Gavel className="w-4 h-4 text-pressbox-orange flex-none" aria-hidden="true" />
            {auction.paused ? (
              <span className="font-barlow text-[13px] text-pressbox-text/80">Auction paused by the commissioner.</span>
            ) : iAmNominating ? (
              <span className="font-barlow font-bold text-[14px] text-pressbox-text">Your turn to nominate. Search a player.</span>
            ) : (
              <span className="font-barlow text-[13px] text-pressbox-text/80">
                Waiting on{' '}
                <span className="font-bold text-pressbox-text">
                  {onClockNominatorId ? teamNameById.get(onClockNominatorId) ?? 'next team' : 'next team'}
                </span>{' '}
                to nominate
              </span>
            )}
          </div>

          {iAmNominating && (
            <div className="mt-3 space-y-2">
              <label className="relative block">
                <span className="sr-only">Search player to nominate</span>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pressbox-text/45" aria-hidden="true" />
                <input
                  value={nomSearch}
                  onChange={(e) => {
                    setNomSearch(e.target.value);
                    setNomPlayer(null);
                  }}
                  placeholder="Search a player to nominate"
                  className={cn(FIELD, 'w-full pl-9 pr-3 font-barlow font-normal')}
                  data-testid="auction-nominate-search"
                />
              </label>
              {nomPlayer === null && nomMatches.length > 0 && (
                <ul className="rounded-[12px] bg-pressbox-surface border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
                  {nomMatches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="focus-citrus w-full flex items-center gap-2.5 min-h-[44px] px-3 text-left active:bg-pressbox-tile-high"
                        onClick={() => {
                          setNomPlayer(p);
                          setNomSearch(p.full_name);
                        }}
                      >
                        <Mug p={mugFromDirectory(p)} size="xs" crest />
                        <span className="min-w-0 flex-1 font-barlow font-semibold text-[14px] text-pressbox-text truncate">{p.full_name}</span>
                        <span className="font-plex text-[10px] text-pressbox-text/55 whitespace-nowrap">
                          {p.position} · {p.team}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {nomPlayer !== null && (
                <div className="flex items-center gap-2">
                  <label className="flex-none flex items-center gap-2">
                    <span className={cn(EYEBROW, 'text-pressbox-text/45')}>Opening</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={minBid}
                      step={1}
                      value={nomOpeningBid}
                      onChange={(e) => setNomOpeningBid(e.target.value)}
                      className={cn(FIELD, 'w-[76px] text-center')}
                      data-testid="auction-opening-bid"
                    />
                  </label>
                  <button
                    type="button"
                    className={cn(PRIMARY, 'flex-1 min-w-0 truncate px-3')}
                    disabled={submitting}
                    onClick={handleNominate}
                    data-testid="auction-nominate-submit"
                  >
                    Nominate {nomPlayer.full_name}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Budgets: one strip, YOU first ───────────────────────── */}
      <div className="-mx-3.5 px-3.5 overflow-x-auto scrollbar-hide ios-scroll" data-testid="auction-budgets">
        <div className="flex gap-1.5 w-max pb-0.5">
          {orderedTeams.map((t) => {
            const b = auction.budgets.get(t.id);
            const isMe = t.id === myTeamId;
            const nominating = t.id === onClockNominatorId && nomination === null;
            const leading = nomination !== null && nomination.leadingBidderId === t.id;
            return (
              <div
                key={t.id}
                className={cn(
                  'flex items-center gap-1.5 h-8 px-3 rounded-full bg-pressbox-tile border whitespace-nowrap',
                  isMe ? 'border-pressbox-orange/50' : 'border-white/[0.08]',
                  nominating && 'border-pressbox-sage/60',
                )}
                title={t.team_name}
              >
                {(nominating || leading) && (
                  <span
                    aria-hidden="true"
                    className={cn('w-1.5 h-1.5 rounded-full', nominating ? 'bg-pressbox-sage' : 'bg-pressbox-orange')}
                  />
                )}
                <span className={cn('font-barlow font-semibold text-[12px] max-w-[7.5rem] truncate', isMe ? 'text-pressbox-orange-soft' : 'text-pressbox-text')}>
                  {isMe ? 'You' : t.team_name}
                </span>
                <span className="font-plex font-semibold text-[12px] tabular-nums text-pressbox-text">${b ? b.remaining : '-'}</span>
                <span className="font-plex text-[10px] tabular-nums text-pressbox-text/45">· {b ? b.slotsRemaining : '-'}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────── */}
      {auction.history.length > 0 && (
        <section className="rounded-[14px] bg-pressbox-tile border border-white/[0.08] overflow-hidden">
          <div className="flex items-center justify-between px-3.5 pt-3 pb-1">
            <span className={cn(EYEBROW, 'text-pressbox-text/55')}>Recent results</span>
            <span className={cn(EYEBROW, 'text-pressbox-text/45 tabular-nums')}>{soldCount} sold</span>
          </div>
          <ul className="divide-y divide-white/[0.06] max-h-[224px] overflow-y-auto">
            {auction.history.slice(0, 12).map((h) => {
              const p = h.playerId ? playersById.get(h.playerId) ?? null : null;
              const name = h.playerName || p?.full_name || (h.playerId ? `#${h.playerId}` : 'Player');
              const mine = h.teamId !== null && h.teamId === myTeamId;
              if (h.kind === 'won') {
                return (
                  <li key={h.seq} className="flex items-center gap-2.5 min-h-[44px] px-3.5">
                    <Mug p={p ? mugFromDirectory(p) : { name, image: null, team: null }} size="xs" crest={!!p} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-barlow font-semibold text-[14px] leading-tight text-pressbox-text truncate">{name}</span>
                      <span className={cn(EYEBROW, 'block mt-0.5 tracking-[0.08em]', mine ? 'text-pressbox-orange-soft' : 'text-pressbox-text/45')}>
                        {mine ? 'You' : h.teamId ? teamNameById.get(h.teamId) ?? '-' : '-'}
                        {p ? ` · ${p.position}` : ''}
                      </span>
                    </span>
                    <span className={cn('font-plex font-semibold text-[15px] tabular-nums', mine ? 'text-pressbox-orange-soft' : 'text-pressbox-text')}>
                      ${h.amount}
                    </span>
                  </li>
                );
              }
              if (h.kind === 'no_sale') {
                return (
                  <li key={h.seq} className="flex items-center min-h-[40px] px-3.5 font-barlow text-[12px] text-pressbox-text/55">
                    No sale · {name} went unsold
                  </li>
                );
              }
              return (
                <li key={h.seq} className="flex items-center min-h-[40px] px-3.5 font-barlow text-[12px] text-pressbox-text/55">
                  {h.teamId ? teamNameById.get(h.teamId) ?? 'A team' : 'A team'} skipped
                  {h.reason === 'insufficient_budget' ? ' (budget)' : ''}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
