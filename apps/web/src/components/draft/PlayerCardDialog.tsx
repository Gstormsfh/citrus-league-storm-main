// V2-PARITY (2026-08-17) — tap-for-player-card in the v2 draft room.
//
// Garrett's #1 feedback from the first live friends draft (Citrus Draft
// Night, 12 teams / 252 picks): "player cards don't load when i try and
// click on them." The v1 room had a details surface; the v2 room only
// ever highlighted the row. This dialog is the parity piece: a
// self-contained card built entirely from the Player shape the pool
// already holds — zero new API calls, so it works identically against
// tonight's deployed API and Monday's.
//
// Scoring: mirrors PlayerPool's default (ScoringCalculator with the
// league's settings when provided, default weights otherwise), so the
// FPTS on the card always equals the FPTS column in the pool.

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Player } from '@/services/PlayerService';
import { ScoringCalculator, ScoringSettings } from '@citrus/shared';

interface PlayerCardDialogProps {
  player: Player | null;
  onClose: () => void;
  /** League scoring settings — omit for default weights (same as pool). */
  scoringSettings?: ScoringSettings | null;
  /** Optional draft affordance: shown only when provided AND enabled. */
  onDraft?: (player: Player) => void;
  canDraft?: boolean;
  isSubmitPending?: boolean;
}

const StatTile = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-2 text-center">
    <div className="text-base font-bold text-pastel-cream leading-tight">{value}</div>
    <div className="text-[10px] uppercase tracking-wide text-white/55 mt-0.5">{label}</div>
  </div>
);

export const PlayerCardDialog = ({
  player,
  onClose,
  scoringSettings,
  onDraft,
  canDraft = false,
  isSubmitPending = false,
}: PlayerCardDialogProps) => {
  const fpts = useMemo(() => {
    if (!player) return 0;
    const scorer = new ScoringCalculator(scoringSettings ?? undefined);
    const isGoalie = player.position === 'G';
    return scorer.calculatePoints(
      isGoalie
        ? {
            wins: player.wins || 0,
            saves: player.saves || 0,
            shutouts: player.shutouts || 0,
            goals_against: player.goals_against || 0,
          }
        : {
            goals: player.goals || 0,
            assists: player.assists || 0,
            shots: player.shots || 0,
            blocks: player.blocks || 0,
            hits: player.hits || 0,
            pim: player.pim || 0,
            ppp: player.ppp || 0,
            shp: player.shp || 0,
          },
      isGoalie,
    );
  }, [player, scoringSettings]);

  if (!player) return null;

  const isGoalie = player.position === 'G';
  const gp = player.games_played || 0;
  const toiPerGp =
    player.icetime_seconds && gp
      ? (() => {
          const totalSec = Math.round(player.icetime_seconds / gp);
          const m = Math.floor(totalSec / 60);
          const s = totalSec % 60;
          return `${m}:${s < 10 ? '0' : ''}${s}`;
        })()
      : '—';
  const positions =
    player.eligible_positions && player.eligible_positions.length > 1
      ? player.eligible_positions.join('/')
      : player.position;

  return (
    <Dialog open={player !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-md bg-pastel-surface border-white/10 text-pastel-cream"
        data-testid="player-card-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-pastel-cream">
            <span className="text-lg font-bold">{player.full_name}</span>
            <Badge variant="outline" className="text-[10px] px-1.5">{positions}</Badge>
            <span className="text-sm font-normal text-white/55">{player.team}</span>
          </DialogTitle>
          <DialogDescription className="text-white/55 text-xs">
            Season stats · {gp} games played
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2">
          {isGoalie ? (
            <>
              <StatTile label="W" value={player.wins || 0} />
              <StatTile label="L" value={player.losses || 0} />
              <StatTile label="GAA" value={player.goals_against_average ? player.goals_against_average.toFixed(2) : '0.00'} />
              <StatTile label="SV%" value={player.save_percentage ? `${(player.save_percentage * 100).toFixed(1)}` : '0.0'} />
              <StatTile label="Saves" value={player.saves || 0} />
              <StatTile label="SO" value={player.shutouts || 0} />
              <StatTile label="GA" value={player.goals_against || 0} />
              <StatTile label="GP" value={gp} />
            </>
          ) : (
            <>
              <StatTile label="PTS" value={player.points ?? 0} />
              <StatTile label="G" value={player.goals ?? 0} />
              <StatTile label="A" value={player.assists ?? 0} />
              <StatTile label="+/−" value={`${(player.plus_minus ?? 0) > 0 ? '+' : ''}${player.plus_minus ?? 0}`} />
              <StatTile label="PPP" value={player.ppp || 0} />
              <StatTile label="SHP" value={player.shp || 0} />
              <StatTile label="SOG" value={player.shots ?? 0} />
              <StatTile label="HIT" value={player.hits ?? 0} />
              <StatTile label="BLK" value={player.blocks ?? 0} />
              <StatTile label="PIM" value={player.pim || 0} />
              <StatTile label="TOI/GP" value={toiPerGp} />
              <StatTile label="xG" value={player.xGoals != null ? player.xGoals.toFixed(2) : '—'} />
            </>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 ring-1 ring-emerald-400/20 px-3 py-2">
          <div>
            <div className="text-lg font-bold text-emerald-300">{fpts.toFixed(1)}</div>
            <div className="text-[10px] uppercase tracking-wide text-white/55">Season FPTS</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-emerald-300">{gp ? (fpts / gp).toFixed(2) : '—'}</div>
            <div className="text-[10px] uppercase tracking-wide text-white/55">FPTS / GP</div>
          </div>
        </div>

        {onDraft && canDraft && (
          <Button
            className="w-full bg-fantasy-primary hover:bg-fantasy-primary/90"
            disabled={isSubmitPending}
            onClick={() => { onDraft(player); onClose(); }}
            data-testid="player-card-draft-button"
          >
            {isSubmitPending ? 'Submitting…' : `Draft ${player.full_name}`}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};
