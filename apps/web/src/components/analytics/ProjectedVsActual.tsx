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
    <div className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1',
          up ? 'bg-pastel-orange/15 ring-pastel-orange/30' : 'bg-white/5 ring-white/10',
        )}
      >
        {up ? <TrendingUp className="h-3.5 w-3.5" style={{ color: ACTUAL }} />
            : <TrendingDown className="h-3.5 w-3.5 text-white/55" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[13px] font-bold text-pastel-cream">
          {p.name}
        </span>
        <span className="block text-[10px] font-display text-white/55">
          {p.position} · {p.games} GP · {p.actual.toFixed(1)} vs {p.projected.toFixed(1)} proj
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className="block font-varsity text-[14px] font-black leading-none"
          style={{ color: up ? ACTUAL : undefined }}
        >
          <span className={up ? undefined : 'text-white/55'}>
            {pct > 0 ? '+' : ''}{pct}%
          </span>
        </span>
        <span className="block text-[9px] font-display uppercase text-white/55">
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
    <div className={cn('bg-pastel-surface-tile ring-1 ring-white/10 rounded-2xl overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <p className="font-jbmono text-[9px] font-bold uppercase tracking-[0.28em] text-pastel-orange-soft">
            ✦ Projected vs Actual
          </p>
          <h3 className="font-calistoga text-xl text-pastel-cream mt-0.5">Are you beating the model?</h3>
          <p className="text-[11px] text-white/55 mt-1 max-w-sm leading-relaxed">
            The ring is what a roster projected like yours <em>typically</em> returns, not the raw
            projection, which runs hot. Outside the ring is genuine outperformance.
          </p>
        </div>
        {headline && tracking.pct !== null && (
          <div className="shrink-0 text-right">
            <p className="font-varsity text-[30px] font-black leading-none" style={{ color: headline.tone }}>
              {tracking.pct}%
            </p>
            <p className="mt-1 font-display text-[9px] font-semibold uppercase tracking-wide text-white/55">
              {headline.text}
            </p>
          </div>
        )}
      </div>

      {/* Legend — always present for two series, never colour alone. */}
      <div className="flex items-center gap-4 px-5 pb-2">
        {[
          { c: ACTUAL, l: 'Actual' },
          { c: EXPECTED, l: 'Expected (100%)' },
        ].map((s) => (
          <span key={s.l} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.c }} aria-hidden="true" />
            <span className="font-display text-[11px] text-white/55">{s.l}</span>
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
              tick={{ fill: '#FFFFFF8C', fontSize: 11, fontWeight: 600 }}
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
        <div className="border-t border-white/10 px-5 py-4">
          <p className="font-jbmono text-[9px] font-bold uppercase tracking-[0.2em] text-white/55 mb-2">
            Carrying the team
          </p>
          {carrying.map((p) => <DeltaRow key={p.id} p={p} rank="up" />)}
          {dragging.length > 0 && (
            <>
              <p className="font-jbmono text-[9px] font-bold uppercase tracking-[0.2em] text-white/55 mt-4 mb-2">
                Falling short
              </p>
              {dragging.map((p) => <DeltaRow key={p.id} p={p} rank="down" />)}
            </>
          )}
          <p className="mt-3 text-[10px] leading-relaxed text-white/55">
            Ranked by ratio to expectation, not by raw points. The model's error grows with the
            size of a projection, and a ratio is the only comparison that survives it.
          </p>
        </div>
      )}
    </div>
  );
}

export default ProjectedVsActual;
