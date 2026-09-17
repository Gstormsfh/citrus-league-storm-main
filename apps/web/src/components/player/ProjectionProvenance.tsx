import type { CanonicalProjectionContext } from '@citrus/shared';

/**
 * Where a forecast came from, said on the card (2026-09-14).
 *
 * The published context carries `provenance` (MODEL / MANUAL / DEFAULT) and
 * `status` (projected / rates_only / unresolved) all the way to the browser,
 * and until now nothing rendered either. A cohort prior read with the same
 * authority as a model forecast, and a rookie with conditional rates showed
 * only "Season totals unavailable" unless the generated outlook happened to
 * be present. Projection standard rule 5: a number that reaches a screen
 * without provenance is a bug; rendering a fallback as model output is the
 * one error a customer cannot detect.
 *
 * Pure presentation of fields the page already holds. No fetch, no
 * inference: an absent context renders nothing.
 */

const PROVENANCE: Record<string, { label: string; title: string; tone: string }> = {
  MODEL: {
    label: 'Model forecast',
    title: 'Produced by the Citrus projection model from this player’s NHL history.',
    tone: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  },
  MANUAL: {
    label: 'Manual forecast',
    title: 'Set by hand because the model could not see this player (a rookie, or a season missed). Reviewed and recorded.',
    tone: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  },
  DEFAULT: {
    label: 'Cohort prior',
    title: 'A fallback drawn from a comparable cohort, not an individual forecast for this player.',
    tone: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  },
};

const SKATER_RATES: Array<[string, string]> = [
  ['goals', 'G'], ['assists', 'A'], ['shots_on_goal', 'SOG'], ['power_play_points', 'PPP'],
  ['blocks', 'BLK'], ['hits', 'HIT'], ['short_handed_points', 'SHP'], ['penalty_minutes', 'PIM'], ['plus_minus', '+/-'],
];
const GOALIE_RATES: Array<[string, string]> = [
  ['wins', 'W'], ['saves', 'SV'], ['shutouts', 'SO'], ['goals_against', 'GA'],
];

function rateLine(rates: Record<string, unknown> | null | undefined, isGoalie: boolean): string | null {
  if (!rates) return null;
  const parts = (isGoalie ? GOALIE_RATES : SKATER_RATES)
    .map(([key, label]) => {
      const value = rates[key];
      return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} ${label}` : null;
    })
    .filter((p): p is string => p !== null);
  return parts.length ? parts.join(' · ') : null;
}

export function ProjectionProvenance({ context, isGoalie = false, className = '' }: {
  context?: CanonicalProjectionContext | null;
  isGoalie?: boolean;
  className?: string;
}) {
  if (!context) return null;
  const chip = context.provenance ? PROVENANCE[context.provenance] : undefined;
  const status = context.status;
  const orgPrior = context.exposure_policy === 'organization_prior_remaining';
  const rates = status === 'rates_only' ? rateLine(context.rates, isGoalie) : null;

  if (!chip && status !== 'rates_only' && status !== 'unresolved' && !orgPrior) return null;

  return (
    <div className={`text-xs ${className}`} data-testid="projection-provenance">
      <div className="flex flex-wrap items-center gap-1.5">
        {chip && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${chip.tone}`}
            title={chip.title}
          >
            {chip.label}
          </span>
        )}
        {status === 'rates_only' && (
          <span className="inline-flex items-center rounded-full border border-white/20 bg-white/5 px-2 py-0.5 font-semibold uppercase tracking-wide text-muted-foreground" title="Per-game rates are published, but no NHL workload has been allocated, so there is no season total.">
            Conditional rates
          </span>
        )}
        {status === 'unresolved' && (
          <span className="inline-flex items-center rounded-full border border-white/20 bg-white/5 px-2 py-0.5 font-semibold uppercase tracking-wide text-muted-foreground" title="No supported production rates for this player in the current publication.">
            No supported forecast
          </span>
        )}
      </div>
      {status === 'rates_only' && (
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          {rates
            ? <>Per {isGoalie ? 'start' : 'game'}, conditional on NHL {isGoalie ? 'starts' : 'games'}: <span className="text-foreground">{rates}</span>. No NHL workload is allocated, so there is no season total.</>
            : <>Conditional rates are published without an allocated NHL workload, so there is no season total.</>}
        </p>
      )}
      {orgPrior && status !== 'rates_only' && (
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          Projected games come from a low-confidence organization opportunity assumption, not a confirmed NHL role.
        </p>
      )}
    </div>
  );
}
