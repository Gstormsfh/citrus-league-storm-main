import { useMemo } from 'react';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip,
} from 'recharts';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  categoryPerformance, rankByExpectation, rosterTracking,
  type CategoryKey, type CategoryPair, type PlayerDelta,
} from '@/utils/teamAnalytics';

/**
 * PROJECTED vs ACTUAL (2026-08-27)
 *
 * Asked for as "show projection data — and actuals. That way people can see
 * how their team projects; and how their team is performing." That framing is
 * better than the alternatives it replaced: projections exist from a team's
 * first day, so this has something true to say before any history accumulates,
 * and the GAP between the two shapes is itself the insight rather than an
 * apology for a short season.
 *
 * The radar is deliberate and borrowed from the Roster page's Category
 * Balance, which reads well: same six axes, same order, so a manager looking
 * at both charts is reading the same shape twice. Two overlaid shapes is what
 * a radar is genuinely good at — one set of categories, two series, and the
 * story is where they diverge.
 *
 * EVERY NUMBER HERE IS CALIBRATED. See teamAnalytics.ts: the projection model
 * runs hot, and worse at the top of its range where rostered players live, so
 * raw actual/projected would report every team in every league as ~30% under.
 * The 100% ring is what a roster like this TYPICALLY returns.
 *
 * COLOR: #E86A14 / #1FA378, validated against the #1A2A20 tile surface —
 * lightness band, chroma floor, CVD separation (ΔE 11.4 protan), normal-vision
 * separation (26.3) and contrast all pass. The orange is the brand orange
 * stepped for a dark surface, not a different colour. The chart this replaced
 * used #3b82f6 with an #e5e7eb grid — a stock blue and a light-theme grid on a
 * dark forest page.
 */

const ACTUAL = '#E86A14';
const EXPECTED = '#1FA378';

export interface ProjectedVsActualProps {
  totals: Partial<Record<CategoryKey, CategoryPair>>;
  players: Array<{
    id: string | number; name: string; position: string;
    projectedPoints: number; actualPoints: number; games: number;
  }>;
  className?: string;
}

function DeltaRow({ p, rank }: { p: PlayerDelta; rank: 'up' | 'down' }) {
  const pct = Math.round((p.ratio - 1) * 100);
  const up = rank === 'up';
  return (
    /* PRESS BOX (2026-09-04): the row ladder -- Barlow name, Plex meta,
       Plex figure. Up keeps the chart's orange so the list and the shape
       agree; down is the 55% cream every quiet figure wears. */
    <div className="flex items-center gap-3 py-2 border-b border-white/[0.06] last:border-0">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border',
          up ? 'bg-pressbox-orange/[0.12] border-pressbox-orange/30' : 'bg-white/[0.04] border-white/[0.08]',
        )}
      >
        {up ? <TrendingUp className="h-3.5 w-3.5" style={{ color: ACTUAL }} />
            : <TrendingDown className="h-3.5 w-3.5 text-pressbox-text/55" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-barlow text-[14px] font-semibold text-pressbox-text">
          {p.name}
        </span>
        <span className="block mt-0.5 font-plex font-medium text-[10px] tracking-[0.04em] text-pressbox-text/55">
          {p.position} · {p.games} GP · {p.actual.toFixed(1)} VS {p.projected.toFixed(1)} PROJ
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className="block font-plex font-semibold text-[15px] leading-none tabular-nums"
          style={{ color: up ? ACTUAL : undefined }}
        >
          <span className={up ? undefined : 'text-pressbox-text/55'}>
            {pct > 0 ? '+' : ''}{pct}%
          </span>
        </span>
        <span className="block mt-1 font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/45 tabular-nums">
          {p.delta > 0 ? '+' : ''}{p.delta.toFixed(1)} pts
        </span>
      </span>
    </div>
  );
}

export function ProjectedVsActual({ totals, players, className }: ProjectedVsActualProps) {
  const points = useMemo(() => categoryPerformance(totals), [totals]);
  const tracking = useMemo(() => rosterTracking(points), [points]);
  const ranked = useMemo(() => rankByExpectation(players), [players]);

  const carrying = ranked.slice(0, 3);
  const dragging = ranked.slice(-3).reverse().filter((p) => !carrying.includes(p));

  const headline =
    tracking.pct === null ? null
    : tracking.pct >= 105 ? { text: 'Outperforming', tone: ACTUAL, Icon: TrendingUp }
    : tracking.pct <= 95  ? { text: 'Underperforming', tone: '#FFFFFF8C', Icon: TrendingDown }
    :                       { text: 'On expectation', tone: EXPECTED, Icon: Minus };

  return (
    /* PRESS BOX (2026-09-04): the tile, the eyebrow, the condensed head and
       the Plex figure -- the player card's vocabulary. The radar keeps its
       two validated colours; they were chosen for this surface. */
    <div className={cn('pb-type bg-pressbox-tile border border-white/[0.08] rounded-[12px] overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <p className="font-plex font-semibold text-[9px] tracking-[0.14em] uppercase text-pressbox-orange-soft">
            Projected vs actual
          </p>
          <h3 className="mt-1 font-condensed font-bold text-[20px] uppercase tracking-[0.02em] leading-none text-pressbox-text">
            Are you beating the model?
          </h3>
          <p className="mt-1.5 max-w-sm font-barlow text-[12px] leading-[1.45] text-pressbox-text/60">
            The ring is what a roster projected like yours <em>typically</em> returns, not the raw
            projection, which runs hot. Outside the ring is real outperformance.
          </p>
        </div>
        {headline && tracking.pct !== null && (
          <div className="shrink-0 text-right">
            <p className="font-plex font-semibold text-[30px] leading-none tabular-nums" style={{ color: headline.tone }}>
              {tracking.pct}%
            </p>
            <p className="mt-1 font-plex font-medium text-[9px] tracking-[0.1em] uppercase text-pressbox-text/55">
              {headline.text}
            </p>
          </div>
        )}
      </div>

      {/* Legend — always present for two series, never colour alone. */}
      <div className="flex items-center gap-4 px-4 pb-2">
        {[
          { c: ACTUAL, l: 'ACTUAL' },
          { c: EXPECTED, l: 'EXPECTED · 100%' },
        ].map((s) => (
          <span key={s.l} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.c }} aria-hidden="true" />
            <span className="font-plex font-medium text-[9px] tracking-[0.08em] text-pressbox-text/55">{s.l}</span>
          </span>
        ))}
      </div>

      <div className="h-[300px] w-full px-2">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={points} cx="50%" cy="52%" outerRadius="72%">
            {/* Recessive grid, on-surface — not the light-theme #e5e7eb the
                previous chart used on a dark page. */}
            <PolarGrid stroke="#FFFFFF1F" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: '#F3EFE68C', fontSize: 10, fontWeight: 600, fontFamily: '"IBM Plex Mono", ui-monospace, monospace' }}
            />
            {/* Domain tops out at 160, not 200. The clamp in
                categoryPerformance still admits 200, but a 200 ceiling puts
                the 100% expectation ring at exactly half the radius, which
                renders both shapes small enough to read as an empty chart —
                measured at 93px across in a 270px box. 160 puts expectation
                at ~62% of the radius and gives the interesting band (roughly
                60–140%) most of the plot. */}
            <PolarRadiusAxis angle={30} domain={[0, 160]} tick={false} axisLine={false} />
            <Radar name="Expected" dataKey="expected" stroke={EXPECTED} strokeWidth={2}
                   strokeDasharray="5 4" fill={EXPECTED} fillOpacity={0.16} />
            <Radar name="Actual" dataKey="actual" stroke={ACTUAL} strokeWidth={2.5}
                   fill={ACTUAL} fillOpacity={0.42} />
            <Tooltip
              cursor={{ stroke: '#FFFFFF33' }}
              contentStyle={{
                background: '#243429', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10, fontSize: 12,
              }}
              labelStyle={{ color: '#FFF8F0', fontWeight: 700 }}
              formatter={(v: number, n: string, item: { payload?: { raw?: CategoryPair } }) => {
                if (n === 'Expected') return [`100% (${item?.payload?.raw?.projected.toFixed(1) ?? '-'} proj)`, 'Expected'];
                return [`${v}% (${item?.payload?.raw?.actual.toFixed(1) ?? '-'} actual)`, 'Actual'];
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {ranked.length > 0 && (
        <div className="border-t border-white/[0.06] px-4 py-4">
          <p className="mb-1 font-plex font-semibold text-[9px] tracking-[0.14em] uppercase text-pressbox-text/45">
            Carrying the team
          </p>
          {carrying.map((p) => <DeltaRow key={p.id} p={p} rank="up" />)}
          {dragging.length > 0 && (
            <>
              <p className="mt-4 mb-1 font-plex font-semibold text-[9px] tracking-[0.14em] uppercase text-pressbox-text/45">
                Falling short
              </p>
              {dragging.map((p) => <DeltaRow key={p.id} p={p} rank="down" />)}
            </>
          )}
          <p className="mt-3 font-barlow text-[11px] leading-[1.45] text-pressbox-text/50">
            Ranked by ratio to expectation, not by raw points. The model's error grows with the
            size of a projection, and a ratio is the only comparison that survives it.
          </p>
        </div>
      )}
    </div>
  );
}

export default ProjectedVsActual;
