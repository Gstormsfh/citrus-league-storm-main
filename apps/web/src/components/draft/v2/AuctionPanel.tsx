// Auction room panel (2026-08-24 launch build).
//
// Renders the live auction surface for `format === 'auction'` lobbies
// on the v2 rail: the active nomination (player, leading bid + bidder,
// countdown), bid controls, the nominate flow for the on-clock
// nominator, per-team budget board, and a recent-sales feed. State
// comes exclusively from `useAuctionDerived` (seeded from the engine
// snapshot, folded from live WS events — see deriveAuctionState.ts);
// actions go out over the draft-v2 auction HTTP routes and confirm
// back through the event stream.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Gavel, Timer, Coins, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuctionDerived, useDraftMatrix } from '@/stores/draftClientStore';
import {
  submitBid,
  submitNomination,
} from '@/lib/draftClient/submitAuctionAction';
import type { Player } from '@/services/PlayerService';
import type { FetchedTeam } from '@/lib/draftClient/v1Adapters';

interface AuctionPanelProps {
  leagueId: string;
  teams: FetchedTeam[];
  playersById: ReadonlyMap<string, Player>;
  myTeamId: string | null;
}

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

export function AuctionPanel({ leagueId, teams, playersById, myTeamId }: AuctionPanelProps) {
  const auction = useAuctionDerived();
  const matrix = useDraftMatrix();
  const { toast } = useToast();

  const [bidInput, setBidInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [nomSearch, setNomSearch] = useState('');
  const [nomPlayer, setNomPlayer] = useState<Player | null>(null);
  const [nomOpeningBid, setNomOpeningBid] = useState<string>('1');
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
    rotation.length > 0
      ? rotation[auction.nominationsCompleted % rotation.length]
      : null;
  const iAmNominating =
    nomination === null && myTeamId !== null && onClockNominatorId === myTeamId;

  const myBudget = myTeamId ? auction.budgets.get(myTeamId) : undefined;
  const minBid = 1;
  const minNextBid = nomination ? Math.floor(nomination.leadingBid) + minBid : minBid;
  const myMaxAffordable = myBudget
    ? myBudget.remaining - Math.max(0, myBudget.slotsRemaining - 1) * minBid
    : null;

  const resolvedNomPlayerName =
    nomination === null
      ? ''
      : nomination.playerName ||
        playersById.get(nomination.playerId)?.full_name ||
        `#${nomination.playerId}`;

  const iAmLeading =
    nomination !== null && myTeamId !== null && nomination.leadingBidderId === myTeamId;

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
      // `=== false`, not `!` or an `else`. AuctionActionResult is a properly
      // discriminated union, but tsconfig.app.json still sets
      // strictNullChecks:false, and without it TypeScript refuses to narrow a
      // union through a negated boolean-literal discriminant or through the
      // else-arm of a truthiness test. `result.message` then fails to resolve
      // even though the error arm guarantees it. An explicit comparison
      // narrows under both settings and is the identical expression at
      // runtime. Revisit when the strictNullChecks migration lands
      // (tsconfig.app.json "Phase 2").
      if (result.ok === false) {
        toast({
          title: 'Bid Not Placed',
          description: result.message,
          variant: 'destructive',
        });
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
      // `=== false`, not `!` or an `else`. AuctionActionResult is a properly
      // discriminated union, but tsconfig.app.json still sets
      // strictNullChecks:false, and without it TypeScript refuses to narrow a
      // union through a negated boolean-literal discriminant or through the
      // else-arm of a truthiness test. `result.message` then fails to resolve
      // even though the error arm guarantees it. An explicit comparison
      // narrows under both settings and is the identical expression at
      // runtime. Revisit when the strictNullChecks migration lands
      // (tsconfig.app.json "Phase 2").
      if (result.ok === false) {
        toast({
          title: 'Nomination Failed',
          description: result.message,
          variant: 'destructive',
        });
      } else {
        setNomPlayer(null);
        setNomSearch('');
        setNomOpeningBid('1');
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

  return (
    <div className="space-y-3" data-testid="auction-panel">
      {/* ── Active nomination / nominate strip ─────────────────── */}
      {nomination !== null ? (
        <Card className="border-0 ring-2 ring-pastel-orange/40 bg-pastel-orange/10">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-jbmono uppercase tracking-[0.28em] text-pastel-orange-soft font-bold">
                  <Gavel className="w-3.5 h-3.5" />
                  On the block
                  {nomination.isAutoNominated && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">auto</Badge>
                  )}
                  {auction.paused && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">PAUSED</Badge>
                  )}
                </div>
                <div className="text-xl font-bold truncate" data-testid="auction-player">
                  {resolvedNomPlayerName}
                </div>
                <div className="text-sm text-muted-foreground">
                  Leading: <span className="font-bold tabular-nums">${nomination.leadingBid}</span>
                  {' · '}
                  <span className={iAmLeading ? 'text-pastel-orange font-bold' : ''}>
                    {iAmLeading
                      ? 'you'
                      : teamNameById.get(nomination.leadingBidderId) ?? 'Unknown team'}
                  </span>
                  <span className="ml-2 text-xs">
                    (nominated by {teamNameById.get(nomination.nominatorTeamId) ?? '-'})
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-2xl font-bold tabular-nums" data-testid="auction-countdown">
                <Timer className="w-5 h-5 text-pastel-orange" />
                {countdown !== null ? `${countdown}s` : '-'}
              </div>
            </div>

            {/* Bid controls */}
            {myTeamId !== null && !auction.paused && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={
                    submitting ||
                    iAmLeading ||
                    (myMaxAffordable !== null && minNextBid > myMaxAffordable)
                  }
                  onClick={() => handleBid(minNextBid)}
                  data-testid="auction-quick-bid"
                >
                  Bid ${minNextBid}
                </Button>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={minNextBid}
                    step={1}
                    value={bidInput}
                    onChange={(e) => setBidInput(e.target.value)}
                    placeholder={`$${minNextBid}+`}
                    className="w-24 h-9"
                    data-testid="auction-bid-input"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      submitting ||
                      iAmLeading ||
                      !Number.isFinite(Number(bidInput)) ||
                      Number(bidInput) < minNextBid ||
                      (myMaxAffordable !== null && Number(bidInput) > myMaxAffordable)
                    }
                    onClick={() => handleBid(Math.floor(Number(bidInput)))}
                  >
                    Bid custom
                  </Button>
                </div>
                {iAmLeading && (
                  <span className="text-xs text-pastel-orange font-bold">
                    You lead this auction.
                  </span>
                )}
                {myMaxAffordable !== null && (
                  <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                    Max affordable: ${Math.max(0, myMaxAffordable)}
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 ring-1 ring-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm">
              <Gavel className="w-4 h-4 text-pastel-orange" />
              {auction.paused ? (
                <span>Auction paused by the commissioner.</span>
              ) : iAmNominating ? (
                <span className="font-bold">Your turn to nominate. Search a player below.</span>
              ) : (
                <span>
                  Waiting on{' '}
                  <span className="font-bold">
                    {onClockNominatorId
                      ? teamNameById.get(onClockNominatorId) ?? 'next team'
                      : 'next team'}
                  </span>{' '}
                  to nominate…
                </span>
              )}
            </div>

            {/* Nominate flow (only for the on-clock nominator) */}
            {iAmNominating && (
              <div className="mt-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={nomSearch}
                    onChange={(e) => {
                      setNomSearch(e.target.value);
                      setNomPlayer(null);
                    }}
                    placeholder="Search player to nominate…"
                    className="pl-8 h-9"
                    data-testid="auction-nominate-search"
                  />
                </div>
                {nomPlayer === null && nomMatches.length > 0 && (
                  <div className="rounded-lg ring-1 ring-white/10 divide-y divide-white/5 overflow-hidden">
                    {nomMatches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                        onClick={() => {
                          setNomPlayer(p);
                          setNomSearch(p.full_name);
                        }}
                      >
                        <span className="font-semibold">{p.full_name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {p.position} · {p.team}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {nomPlayer !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Opening bid ($)</span>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={nomOpeningBid}
                      onChange={(e) => setNomOpeningBid(e.target.value)}
                      className="w-20 h-9"
                      data-testid="auction-opening-bid"
                    />
                    <Button size="sm" disabled={submitting} onClick={handleNominate} data-testid="auction-nominate-submit">
                      Nominate {nomPlayer.full_name}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Budget board ───────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2" data-testid="auction-budgets">
        {teams.map((t) => {
          const b = auction.budgets.get(t.id);
          const isMe = t.id === myTeamId;
          const nominating = t.id === onClockNominatorId && nomination === null;
          return (
            <div
              key={t.id}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ${
                isMe ? 'ring-pastel-orange/50 bg-pastel-orange/10 font-bold' : 'ring-white/10 bg-white/5'
              } ${nominating ? 'ring-2 ring-pastel-orange/60' : ''}`}
            >
              <Coins className="w-3 h-3 text-pastel-orange" />
              <span className="truncate max-w-[9rem]">{t.team_name}</span>
              <span className="tabular-nums font-bold">${b ? b.remaining : '-'}</span>
              <span className="text-muted-foreground tabular-nums">
                · {b ? b.slotsRemaining : '-'} slots
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Recent sales feed ──────────────────────────────────── */}
      {auction.history.length > 0 && (
        <Card className="border-0 ring-1 ring-white/10">
          <CardContent className="p-3">
            <div className="text-[10px] font-jbmono uppercase tracking-[0.28em] text-muted-foreground font-bold mb-2">
              Recent results
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {auction.history.slice(0, 12).map((h) => (
                <div key={h.seq} className="text-sm flex items-center gap-2">
                  {h.kind === 'won' && (
                    <>
                      <span className="font-semibold truncate">
                        {h.playerName ??
                          (h.playerId ? playersById.get(h.playerId)?.full_name : null) ??
                          (h.playerId ? `#${h.playerId}` : 'Player')}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="truncate">{h.teamId ? teamNameById.get(h.teamId) ?? '-' : '-'}</span>
                      <span className="ml-auto font-bold tabular-nums">${h.amount}</span>
                    </>
                  )}
                  {h.kind === 'no_sale' && (
                    <span className="text-muted-foreground">
                      No sale. {h.playerName ?? 'nomination'} went unsold
                    </span>
                  )}
                  {h.kind === 'skipped' && (
                    <span className="text-muted-foreground">
                      {h.teamId ? teamNameById.get(h.teamId) ?? 'A team' : 'A team'} skipped
                      {h.reason === 'insufficient_budget' ? ' (budget)' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
