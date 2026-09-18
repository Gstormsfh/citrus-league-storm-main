import { useId } from 'react';
import { SAMPLE_OPTIONS, type SampleKind } from './leaderboardSamples';

export function LeaderboardSampleFilter({ kind, minimum, onChange, searching }: {
  kind: SampleKind | null; minimum: number; onChange: (n: number) => void; searching: boolean;
}) {
  const id = useId();
  if (!kind) return null;
  const unit = kind === 'shotsFaced' ? 'shots faced' : 'minutes';
  return <div className="my-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="text-xs font-semibold">Minimum {kind === 'shotsFaced' ? 'shots faced' : kind === 'garMinutes' ? 'GAR ice time' : 'ice time'}</label>
      <select id={id} value={minimum} onChange={event => onChange(Number(event.target.value))} className="min-h-11 rounded-md border border-white/15 bg-pressbox-tile text-pressbox-text px-3 text-sm" disabled={searching}>
        {SAMPLE_OPTIONS.map(n => <option key={n} value={n}>{n === 0 ? 'All samples' : `${n}+ ${unit}`}</option>)}
      </select>
    </div>
    <p className="text-xs text-pressbox-text/60 mt-2" aria-live="polite">
      {searching ? 'Search includes all sample sizes. Clear search to return to qualified leaders.'
        : minimum === 0 ? 'All samples shown. Small samples can produce extreme rates.'
        : `Only players with at least ${minimum} ${unit}. A comparison filter, not a guarantee of reliability.`}
    </p>
  </div>;
}
