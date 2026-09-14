/**
 * IMPORT (2026-09-13): the one line on League HQ that turns an import into a
 * claimed history. After a commissioner brings a league over, every other
 * manager has seasons on the shelf and no account attached; nobody reads a
 * "League history" tile to find that out. This banner asks, once, and sends
 * them to the trophy room's claim card.
 *
 * Shown only while the server says this person still needs asking
 * (ClaimQuestion.attached is false and there are unclaimed managers). A
 * manager who is new to the league dismisses it for this league on this
 * device; that is a per-viewer convenience, so localStorage, wrapped.
 *
 * Same query key as the trophy room, so a claim there clears it here.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { importApi, type ClaimQuestion } from '@/api/imports';
import { cn } from '@/lib/utils';

const dismissKey = (leagueId: string) => `citrus.history-claim.dismissed.${leagueId}`;

function readDismissed(leagueId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(leagueId)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(leagueId: string): void {
  try {
    window.localStorage.setItem(dismissKey(leagueId), '1');
  } catch {
    // A private window or blocked storage: the banner simply comes back next visit.
  }
}

export interface HistoryClaimBannerProps {
  leagueId: string;
  /** Nothing is asked before sign-in resolves. */
  enabled?: boolean;
  className?: string;
}

export function HistoryClaimBanner({ leagueId, enabled = true, className }: HistoryClaimBannerProps) {
  const [dismissed, setDismissed] = useState(() => readDismissed(leagueId));
  const question = useQuery({
    queryKey: ['league-history-unclaimed', leagueId],
    enabled: enabled && !!leagueId && !dismissed,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClaimQuestion> => (await importApi.listUnclaimed(leagueId)).data ?? { members: [], attached: false },
  });
  const q = question.data;
  if (dismissed || !q || q.attached || q.members.length === 0) return null;
  const n = q.members.length;

  return (
    <section
      className={cn('rounded-[12px] p-3.5 bg-pressbox-tile border border-pressbox-orange/35', className)}
      data-testid="history-claim-banner"
      aria-label="Claim your league history"
    >
      <p className="font-plex font-semibold text-[9px] uppercase tracking-[0.12em] text-pressbox-orange-soft">
        Your league's history is here
      </p>
      <p className="mt-1 font-barlow text-[13px] leading-[1.35] text-pressbox-text/80">
        {n === 1 ? 'One manager' : `${n} managers`} from past seasons {n === 1 ? 'has' : 'have'} no account attached yet. Which one is you? Your titles, records and rivalries follow you.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Link
          to={`/league/${leagueId}/history`}
          className="focus-citrus flex h-[44px] flex-1 items-center justify-center rounded-[10px] bg-pressbox-orange font-condensed font-bold text-[14px] uppercase tracking-[0.1em] text-pressbox-orange-ink"
        >
          Find yourself
        </Link>
        <button
          type="button"
          onClick={() => {
            writeDismissed(leagueId);
            setDismissed(true);
          }}
          className="focus-citrus shrink-0 px-2 font-plex font-medium text-[11px] text-white/55"
        >
          I'm new here
        </button>
      </div>
    </section>
  );
}
