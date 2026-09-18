import { seasonProjectionSummary } from './projectionScoring';
import { projectionContributions } from './projectionContributions';
import type { GameLogEntry } from './gameLogRows';
import { projectionFraming } from './projectionFraming';


export function ProjectionStatBreakdown({ row, scoring, goalie, points = true }: {
  row: Record<string, unknown> | null; scoring: unknown; goalie: boolean; points?: boolean;
}) {
  const items = projectionContributions(row, scoring, goalie);
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {items.map(item => <div key={item.key} className="min-w-0 rounded-lg bg-white/[0.04] p-3">
      <dt className="text-xs text-pressbox-text/75">{item.label}</dt>
      <dd className="mt-1 text-base font-semibold tabular-nums text-pressbox-text">
        {points && item.weight !== 0
          ? item.points === null ? 'N/A' : `${item.points.toFixed(2)} FPTS`
          : item.count === null ? 'N/A' : item.count.toFixed(2)}
      </dd>
      <dd className="mt-1 text-xs text-pressbox-text/65">
        {item.count === null ? 'Forecast unavailable' : points && item.weight !== 0
          ? `${item.count.toFixed(2)} × ${item.weight}` : points ? 'Not scored in this league' : 'Projected total'}
      </dd>
    </div>)}
  </dl>;
}

export function SeasonProjectionCard({ row, scoring, goalie, points }: {
  row: Record<string, unknown> | null; scoring: unknown; goalie: boolean; points: boolean;
}) {
  const summary = seasonProjectionSummary(row, scoring, goalie);
  const framing = projectionFraming();
  return <section aria-label={framing.eyebrow} className="rounded-xl border border-pressbox-orange/40 bg-pressbox-tile p-4 space-y-3">
    <div>
      <p className="mb-1 text-xs font-semibold text-pressbox-orange">{framing.eyebrow}</p>
      <p className="text-xs uppercase tracking-wide text-pressbox-text/75">{points ? 'Projected total fantasy points' : 'Projected season totals'}</p>
      {points && <p className="text-4xl font-bold tabular-nums text-pressbox-orange">{summary ? summary.points.toFixed(1) : 'N/A'}</p>}
      <p className="mt-1 text-xs text-pressbox-text/70">{summary ? `${Number(summary.gp.toFixed(1))} projected ${goalie ? 'starts' : 'games'}${framing.beforeOpener ? '' : ' remaining'}` : 'Some forecast inputs may be unavailable.'}</p>
    </div>
    <ProjectionStatBreakdown row={row} scoring={scoring} goalie={goalie} points={points} />
  </section>;
}

export function UpcomingProjectionCards({ entries, scoring, ready, points }: {
  entries: GameLogEntry[]; scoring: unknown; ready: boolean; points: boolean;
}) {
  return <div className="space-y-2">
    {entries.filter(e => !e.isPast).map((entry, index) => <details key={entry.date}
      open={index === 0} className="rounded-xl border border-white/10 bg-pressbox-tile">
      <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-sm text-pressbox-text">
        <span><span className="block font-semibold">{entry.opponent}</span>
          <span className="text-xs text-pressbox-text/65">{entry.dayLabel} {entry.dateLabel}</span></span>
        <span className="text-right"><span className="block font-bold tabular-nums text-pressbox-orange">
          {ready && points ? entry.projectedPoints === null ? 'N/A' : `${entry.projectedPoints.toFixed(2)} FPTS` : 'Projected stats'}
        </span><span className="text-xs text-pressbox-text/65">Stat breakdown ▾</span></span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        {entry.projection?.calculation_method === 'canonical_expected_volume_v1' &&
          <p className="text-xs text-pressbox-text/75">Season-average allocation. Opponent adjustments and simulation ranges are unavailable for this forecast.</p>}
        {entry.projection?.calculation_method === 'canonical_goalie_calendar_v1' &&
          <p className="text-xs text-pressbox-text/75">Calendar-adjusted expected workload, not a confirmed start. Return dates are conditional; opponent adjustments and simulation ranges are unavailable.</p>}
        {entry.isGoalie && <p className="text-xs text-pressbox-text/75">Expected starts: {typeof entry.projection?.expected_starts === 'number' ? entry.projection.expected_starts.toFixed(2) : 'N/A'}</p>}
        {ready ? <ProjectionStatBreakdown row={entry.projection} scoring={scoring} goalie={entry.isGoalie} points={points} />
          : <p className="text-sm text-pressbox-text/75">League scoring unavailable.</p>}
      </div>
    </details>)}
  </div>;
}
