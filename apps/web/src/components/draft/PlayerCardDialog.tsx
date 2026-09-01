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
import { cn } from '@/lib/utils';
import { generatePlayerWriteup, type WriteupTone } from '@/utils/playerWriteup';

/** Scouting-tag palette — same trio PlayerStatsModal uses, so a tag
 * reads identically on a roster card and in the draft room. Caution is
 * amber (the injury-badge language), deliberately not orange — orange
 * is the app's "this is you" signal. */
const WRITEUP_TAG_STYLES: Record<WriteupTone, string> = {
  positive: 'bg-pastel-sage/20 text-pastel-cream ring-pastel-sage/40',
  neutral: 'bg-white/5 text-white/70 ring-white/15',
  caution: 'bg-amber-500/15 text-amber-200 ring-amber-500/30',
};

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

  // DRAFT-ROOM WRITE-UPS (2026-09-01) — founder, mid-mock-draft: "don't
  // have the player write ups, etc in the draft room player cards?? We
  // need these all baked in." The roster and free-agent modals have
  // carried the deterministic Player Outlook since 2026-08-25
  // (utils/playerWriteup — prose derived from the same stat line the
  // card shows, so it can never contradict the numbers and costs no
  // network call, which is exactly the budget a live draft has). This
  // adapts the pool's Player shape to the writeup engine's input.
  const writeup = useMemo(() => {
    if (!player) return null;
    const gamesPlayed = player.games_played || 0;
    const toiPerGame =
      player.icetime_seconds && gamesPlayed
        ? (() => {
            const totalSec = Math.round(player.icetime_seconds / gamesPlayed);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            return `${m}:${s < 10 ? '0' : ''}${s}`;
          })()
        : undefined;
    return generatePlayerWriteup({
      id: player.id,
      name: player.full_name,
      position: player.position,
      eligible_positions: player.eligible_positions,
      number: 0,
      starter: false,
      team: player.team,
      stats: {
        gamesPlayed,
        goals: player.goals ?? 0,
        assists: player.assists ?? 0,
        points: player.points ?? 0,
        plusMinus: player.plus_minus ?? 0,
        shots: player.shots ?? 0,
        hits: player.hits ?? 0,
        blockedShots: player.blocks ?? 0,
        powerPlayPoints: player.ppp ?? 0,
        shortHandedPoints: player.shp ?? 0,
        pim: player.pim ?? 0,
        xGoals: player.xGoals ?? undefined,
        toi: toiPerGame,
        wins: player.wins ?? 0,
        losses: player.losses ?? 0,
        gaa: player.goals_against_average ?? undefined,
        savePct: player.save_percentage ?? undefined,
        shutouts: player.shutouts ?? 0,
        saves: player.saves ?? 0,
        goalsAgainst: player.goals_against ?? 0,
      },
    });
  }, [player]);

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
        /* max-h + scroll (2026-09-01): with the Outlook block the card can
           outgrow a phone viewport; the dialog scrolls instead of clipping
           the Draft button off-screen. */
        className="max-w-md max-h-[85vh] overflow-y-auto bg-pastel-surface border-white/10 text-pastel-cream"
        data-testid="player-card-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-pastel-cream">
            {player.headshot_url && (
              <img
                loading="lazy"
                decoding="async"
                src={player.headshot_url}
                alt=""
                aria-hidden="true"
                className="h-10 w-10 flex-shrink-0 rounded-lg bg-white/10 object-cover ring-1 ring-white/15"
                onError={(e) => {
                  // Headshot 404s (offseason mug gaps) collapse to text-only.
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
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

        {/* Player Outlook — same surface the roster modal leads with
            (PlayerStatsModal), placed after the numbers here because a
            manager on the clock scans the stat grid first and reads
            prose second. */}
        {writeup && (
          <div
            className="rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2.5"
            data-testid="player-card-writeup"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[9px] uppercase tracking-[0.18em] text-white/55">
                Player Outlook
              </span>
              <span className="flex-shrink-0 text-[9px] text-white/55">via Citrus</span>
            </div>
            <div className="text-sm font-bold leading-snug text-pastel-cream">
              {writeup.headline}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-white/70">
              {writeup.summary}
            </p>
            {writeup.analysis && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">
                <span className="font-bold text-pastel-cream">Analysis: </span>
                {writeup.analysis}
              </p>
            )}
            {writeup.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {writeup.tags.map((tag) => (
                  <span
                    key={tag.label}
                    className={cn(
                      'inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1',
                      WRITEUP_TAG_STYLES[tag.tone],
                    )}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {onDraft && canDraft && (
          <Button
            className="w-full font-bold bg-fantasy-primary text-[#0F1F15] hover:bg-fantasy-primary/90"
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
