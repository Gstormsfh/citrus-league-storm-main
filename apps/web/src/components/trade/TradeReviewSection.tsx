import { useEffect, useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, XCircle, Scale, Clock, AlertCircle } from 'lucide-react';
import { TradeService, type TradeOfferWithPlayers } from '@/services/TradeService';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';

interface TradeReviewSectionProps {
  /** All trades visible to this user in the current league */
  tradeOffers: TradeOfferWithPlayers[];
  /** Current user's team id — used to exclude their votes and hide trades they are involved in */
  myTeamId: string | null;
  /** Called after a vote so the parent can reload offers */
  onVoted: () => Promise<void> | void;
}

interface VoteState {
  approveCount: number;
  vetoCount: number;
  votesNeeded: number;
  myVote: 'approve' | 'veto' | null;
  loading: boolean;
}

/**
 * Countdown helper — returns "Xh Ym" or "ended"
 */
const formatCountdown = (reviewEndsAt: string | null): string => {
  if (!reviewEndsAt) return '—';
  const diffMs = new Date(reviewEndsAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Ended';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
};

export const TradeReviewSection = ({ tradeOffers, myTeamId, onVoted }: TradeReviewSectionProps) => {
  const { toast } = useToast();
  const [voteStates, setVoteStates] = useState<Record<string, VoteState>>({});
  const [tick, setTick] = useState(0);

  // 30-second tick so countdowns stay fresh without a network hit
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Only league-vote trades the user is NOT involved in
  const reviewTrades = useMemo(
    () =>
      tradeOffers.filter(
        (o) =>
          o.status === 'under_review' &&
          o.from_team_id !== myTeamId &&
          o.to_team_id !== myTeamId,
      ),
    [tradeOffers, myTeamId],
  );

  const loadVotes = useCallback(
    async (tradeId: string) => {
      try {
        const { votes } = await TradeService.getTradeVotes(tradeId);
        const approveCount = votes.filter((v) => v.vote === 'approve').length;
        const vetoCount = votes.filter((v) => v.vote === 'veto').length;
        const mine = myTeamId ? votes.find((v) => v.voterTeamId === myTeamId) : null;

        setVoteStates((prev) => ({
          ...prev,
          [tradeId]: {
            approveCount,
            vetoCount,
            votesNeeded: prev[tradeId]?.votesNeeded ?? 0,
            myVote: mine ? (mine.vote as 'approve' | 'veto') : null,
            loading: false,
          },
        }));
      } catch (error) {
        logger.error('Failed to load votes for trade', { tradeId, error });
      }
    },
    [myTeamId],
  );

  // Load vote counts once per trade (and whenever review set changes)
  useEffect(() => {
    reviewTrades.forEach((trade) => {
      if (!voteStates[trade.id]) {
        setVoteStates((prev) => ({
          ...prev,
          [trade.id]: { approveCount: 0, vetoCount: 0, votesNeeded: 0, myVote: null, loading: true },
        }));
        loadVotes(trade.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewTrades.length]);

  const handleVote = async (tradeId: string, vote: 'approve' | 'veto') => {
    if (!myTeamId) {
      toast({ title: 'No team', description: 'You must be on a team to vote.', variant: 'destructive' });
      return;
    }

    setVoteStates((prev) => ({
      ...prev,
      [tradeId]: { ...(prev[tradeId] || { approveCount: 0, vetoCount: 0, votesNeeded: 0, myVote: null }), loading: true },
    }));

    const result = await TradeService.submitTradeVote(tradeId, myTeamId, vote);

    if (!result.success) {
      toast({
        title: 'Vote failed',
        description: result.error || 'Could not submit vote.',
        variant: 'destructive',
      });
      setVoteStates((prev) => ({
        ...prev,
        [tradeId]: { ...(prev[tradeId] || { approveCount: 0, vetoCount: 0, votesNeeded: 0, myVote: null }), loading: false },
      }));
      return;
    }

    setVoteStates((prev) => ({
      ...prev,
      [tradeId]: {
        approveCount: result.approveCount,
        vetoCount: result.vetoCount,
        votesNeeded: result.votesNeeded,
        myVote: vote,
        loading: false,
      },
    }));

    if (result.isVetoed) {
      toast({
        title: 'Trade vetoed',
        description: 'Your vote pushed the trade past the veto threshold.',
      });
      await onVoted();
    } else {
      toast({
        title: vote === 'veto' ? 'Veto recorded' : 'Approval recorded',
        description: `${result.vetoCount} veto(s) — threshold ${result.votesNeeded}`,
      });
    }
  };

  // Silence unused-var lint on `tick` — it's only there to force re-renders
  void tick;

  if (reviewTrades.length === 0) return null;

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Scale className="h-5 w-5 text-amber-500" /> Trades Under League Review
        <Badge variant="outline" className="ml-1">
          {reviewTrades.length}
        </Badge>
      </h3>
      <div className="space-y-3">
        {reviewTrades.map((offer) => {
          const state = voteStates[offer.id];
          const vetoCount = state?.vetoCount ?? 0;
          const approveCount = state?.approveCount ?? 0;
          const votesNeeded = state?.votesNeeded ?? 0;
          const myVote = state?.myVote ?? null;
          const progress = votesNeeded > 0 ? Math.min((vetoCount / votesNeeded) * 100, 100) : 0;
          const countdown = formatCountdown(offer.review_ends_at);
          const expired = countdown === 'Ended';

          return (
            <Card key={offer.id} className="border-amber-500/30">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {offer.from_team_name} → {offer.to_team_name}
                    </CardTitle>
                    {offer.message && (
                      <p className="text-sm text-muted-foreground italic mt-1">"{offer.message}"</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300">
                      Under Review
                    </Badge>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {countdown}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">
                      {offer.from_team_name} sends
                    </p>
                    {offer.offered_players.map((p) => (
                      <div key={p.player_id} className="text-sm flex items-center gap-1">
                        <Badge variant="outline" className="h-4 px-1 text-[11px]">
                          {p.position_code}
                        </Badge>
                        {p.full_name}
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">
                      {offer.to_team_name} sends
                    </p>
                    {offer.requested_players.map((p) => (
                      <div key={p.player_id} className="text-sm flex items-center gap-1">
                        <Badge variant="outline" className="h-4 px-1 text-[11px]">
                          {p.position_code}
                        </Badge>
                        {p.full_name}
                      </div>
                    ))}
                  </div>
                </div>

                <Separator className="my-2" />

                {/* Veto progress bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Vetoes: <span className="font-semibold text-foreground">{vetoCount}</span>
                      {votesNeeded > 0 && <> / {votesNeeded} needed</>}
                    </span>
                    <span className="text-muted-foreground">
                      Approvals: <span className="font-semibold text-foreground">{approveCount}</span>
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                  {vetoCount >= votesNeeded && votesNeeded > 0 && (
                    <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                      <AlertCircle className="h-3 w-3" /> Veto threshold reached — trade will be rejected
                    </div>
                  )}
                </div>

                {/* Vote buttons */}
                <div className="flex gap-2 pt-3">
                  <Button
                    size="sm"
                    variant={myVote === 'approve' ? 'default' : 'outline'}
                    className={myVote === 'approve' ? 'bg-green-600 hover:bg-green-500 text-white' : ''}
                    disabled={state?.loading || expired}
                    onClick={() => handleVote(offer.id, 'approve')}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {myVote === 'approve' ? 'Approved' : 'Approve'}
                  </Button>
                  <Button
                    size="sm"
                    variant={myVote === 'veto' ? 'destructive' : 'outline'}
                    disabled={state?.loading || expired}
                    onClick={() => handleVote(offer.id, 'veto')}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    {myVote === 'veto' ? 'Vetoed' : 'Veto'}
                  </Button>
                  {myVote && (
                    <span className="text-xs text-muted-foreground self-center ml-1">
                      Your vote can be changed until the review ends
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TradeReviewSection;
