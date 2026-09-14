/**
 * The keeper and dynasty carry-over: what the import found about the coming
 * draft (who is keeping whom, which future picks changed hands) and the two
 * buttons that land it on the Citrus league. Each row says why it cannot
 * land yet when it cannot: the manager has not claimed a team, or the player
 * is still unmatched. Commissioner only; the server checks.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { importApi, type Carryover } from '@/api/imports';
import { useToast } from '@/hooks/use-toast';
import { seasonLabel } from './trophyLabels';
import { Chip, Eyebrow, HistoryButton, Panel, Row } from './ui';

const dataOf = <T,>(res: unknown): T | null => ((res as { data?: T })?.data ?? null);

export interface CarryoverPanelProps {
  leagueId: string;
  onChanged?: () => void;
}

export function CarryoverPanel({ leagueId, onChanged }: CarryoverPanelProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const carry = useQuery({
    queryKey: ['league-history-carryover', leagueId],
    queryFn: async () => dataOf<Carryover>(await importApi.getCarryover(leagueId)),
  });
  const data = carry.data;
  if (!data) return null;
  const keepers = data.keepers;
  const picks = data.picks;
  if (!keepers.rows.length && !picks.length) return null;

  const run = async (key: string, work: () => Promise<{ title: string; description?: string }>) => {
    setBusy(key);
    try {
      toast(await work());
      await carry.refetch();
      onChanged?.();
    } catch (e) {
      toast({ title: "That didn't apply", description: (e as Error).message || 'Try again in a moment.' });
    } finally {
      setBusy(null);
    }
  };

  const draftLabel = seasonLabel(data.draftSeason);
  const picksForDraft = picks.filter((p) => p.draftSeason === data.draftSeason);
  const picksReady = picksForDraft.filter((p) => !p.blocker && !p.appliedAt).length;

  return (
    <Panel testId="carryover">
      <Eyebrow>✦ Into the {draftLabel} draft</Eyebrow>
      <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-white/55">
        What the league carries into its next draft. A row lands once its manager has claimed a Citrus team and its player is matched.
      </p>

      {keepers.rows.length > 0 && (
        <div className="mt-3" data-testid="carryover-keepers">
          <p className="font-condensed font-bold text-[16px] text-pressbox-text">
            Keepers {keepers.season != null ? `as of ${seasonLabel(keepers.season)}` : ''} · {keepers.ready} ready{keepers.blocked ? `, ${keepers.blocked} waiting` : ''}
          </p>
          <div className="mt-1">
            {keepers.rows.map((r, i, arr) => (
              <Row key={`${r.memberId}:${r.externalPlayerId}`} last={i === arr.length - 1}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-condensed font-bold text-[15px] text-pressbox-text">{r.playerName ?? r.externalPlayerId}</span>
                  <span className="block truncate font-barlow text-[12px] text-white/55">
                    {r.memberName}{r.teamName ? ` · ${r.teamName}` : ''}{r.round != null ? ` · costs round ${r.round}` : ' · no round cost'}
                  </span>
                </span>
                {r.blocker === 'unclaimed' && <Chip>Waiting on claim</Chip>}
                {r.blocker === 'unmatched' && <Chip tone="grapefruit">Player unmatched</Chip>}
                {!r.blocker && <Chip tone="sage">Ready</Chip>}
              </Row>
            ))}
          </div>
          <HistoryButton className="mt-2" disabled={!keepers.ready || busy != null} busy={busy === 'keepers'} onClick={() => run('keepers', async () => {
            const r = dataOf<{ written: number; skippedLocked: number; blocked: number }>(await importApi.applyKeepers(leagueId));
            return { title: 'Keepers designated', description: `${r?.written ?? 0} placed for ${draftLabel}. Managers confirm them in the keeper panel before the draft.` };
          })}>
            {keepers.ready ? `Designate ${keepers.ready} ${keepers.ready === 1 ? 'keeper' : 'keepers'} for ${draftLabel}` : 'Nothing ready to designate yet'}
          </HistoryButton>
        </div>
      )}

      {picks.length > 0 && (
        <div className="mt-4" data-testid="carryover-picks">
          <p className="font-condensed font-bold text-[16px] text-pressbox-text">Traded draft picks · {picks.length}</p>
          <div className="mt-1">
            {picks.map((p, i, arr) => (
              <Row key={`${p.draftSeason}:${p.round}:${p.originalMemberId}`} last={i === arr.length - 1}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-condensed font-bold text-[15px] text-pressbox-text">{seasonLabel(p.draftSeason)} round {p.round}</span>
                  <span className="block truncate font-barlow text-[12px] text-white/55">{p.originalName}'s pick, owned by {p.ownerName}</span>
                </span>
                {p.appliedAt ? <Chip tone="sage">On the board</Chip> : p.blocker ? <Chip>Waiting on claim</Chip> : p.draftSeason === data.draftSeason ? <Chip tone="sage">Ready</Chip> : <Chip>Later draft</Chip>}
              </Row>
            ))}
          </div>
          <p className="mt-2 font-barlow text-[12px] text-white/55">
            Applying puts the owner's team in the original team's slot of the {draftLabel} draft order. Set the draft order first; apply again after any reset.
          </p>
          <HistoryButton className="mt-2" disabled={!picksReady || busy != null} busy={busy === 'picks'} onClick={() => run('picks', async () => {
            const r = dataOf<{ applied: number; alreadyApplied: number; skipped: Array<{ round: number; reason: string }> }>(await importApi.applyTradedPicks(leagueId, data.draftSeason));
            const skipped = r?.skipped.length ? ` ${r.skipped.length} waiting: ${r.skipped[0].reason}` : '';
            return { title: 'Draft order updated', description: `${r?.applied ?? 0} traded ${r?.applied === 1 ? 'pick' : 'picks'} applied.${skipped}` };
          })}>
            {picksReady ? `Apply ${picksReady} traded ${picksReady === 1 ? 'pick' : 'picks'} to the ${draftLabel} draft order` : 'Nothing ready to apply yet'}
          </HistoryButton>
        </div>
      )}
    </Panel>
  );
}
