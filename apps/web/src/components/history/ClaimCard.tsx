/**
 * "Which one is you?" A member who signed up after the import picks their
 * own name from the managers with history and no account attached. The
 * server's claim function does every check; this is the list and one tap.
 */
import { useState } from 'react';
import type { UnclaimedMember } from '@/api/imports';
import { careerLine, seasonLabel } from './trophyLabels';
import { Eyebrow, Panel, HistoryButton } from './ui';

export interface ClaimCardProps {
  members: UnclaimedMember[];
  onClaim: (memberId: string) => Promise<void>;
  onSkip?: () => void;
}

export function ClaimCard({ members, onClaim, onSkip }: ClaimCardProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (members.length === 0) return null;

  const claim = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await onClaim(picked);
    } catch (e) {
      setError((e as Error).message || 'That claim did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel testId="claim-card" className="ring-pressbox-orange/40">
      <Eyebrow>✦ Your history is here</Eyebrow>
      <h2 className="mt-1 font-condensed font-extrabold text-[22px] uppercase tracking-[0.02em] leading-none text-pressbox-text">Which one is you?</h2>
      <p className="mt-1.5 font-barlow text-[13px] leading-[1.45] text-white/55">
        These managers have seasons in this league and no Citrus account yet. Pick yours and every title, record and rivalry follows you.
      </p>
      <div role="radiogroup" aria-label="Managers with unclaimed history" className="mt-3">
        {members.map((m, i) => {
          const selected = picked === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPicked(m.id)}
              className={`flex w-full items-center gap-3 py-2.5 text-left ${i < members.length - 1 ? 'border-b border-white/[0.06]' : ''}`}
            >
              <span className={`h-4 w-4 shrink-0 rounded-full border ${selected ? 'border-pressbox-orange bg-pressbox-orange' : 'border-white/30'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-condensed font-bold text-[16px] text-pressbox-text">{m.display_name}</span>
                <span className="block truncate font-barlow text-[12px] text-white/55">
                  {[m.first_season != null && m.last_season != null ? `${seasonLabel(m.first_season)} to ${seasonLabel(m.last_season)}` : null, careerLine(m)].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-2 font-barlow text-[13px] text-pressbox-grapefruit-text">{error}</p>}
      <div className="mt-3 flex gap-2">
        <HistoryButton onClick={claim} disabled={!picked} busy={busy} className="flex-1">{busy ? 'Claiming' : 'This is me'}</HistoryButton>
        {onSkip && <HistoryButton tone="quiet" onClick={onSkip}>None of these</HistoryButton>}
      </div>
    </Panel>
  );
}
