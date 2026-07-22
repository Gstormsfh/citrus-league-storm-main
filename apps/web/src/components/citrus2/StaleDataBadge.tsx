import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Stale-data badge — first-class signal that a card / dashboard
 * section is showing data that hasn't been refreshed recently.
 *
 * Citrus's data pipeline has multiple silent-failure shapes (see
 * scripts/staging/KNOWN_GAPS.md, May 2026 entries). When a model
 * output table is stale we display this badge instead of pretending
 * the data is fresh. Trust > pristine UI.
 *
 * Severity tiers (computed from days-since-update):
 *   ≤ thresholdDays:           hidden (data is fresh enough)
 *   threshold..2x threshold:   warning (butter chip)
 *   2x..6x threshold:          alert (orange chip)
 *   > 6x threshold:            critical (red chip)
 *
 * Defaults: thresholdDays=14. So 14-30d = warning, 30-84d = alert,
 * 84d+ = critical.
 */

export type StaleDataBadgeVariant = 'inline' | 'block';

interface StaleDataBadgeProps {
  /** Last-update timestamp. ISO string, Date, or null/undefined.
   *  When null/undefined → "data unknown" critical badge. */
  asOf?: string | Date | null;
  /** Freshness threshold in days. Below this, badge is hidden. */
  thresholdDays?: number;
  /** inline = chip; block = full-width banner with explanation. */
  variant?: StaleDataBadgeVariant;
  /** Override the human-readable label. Default: "Last updated …" */
  label?: string;
  className?: string;
}

type Severity = 'warning' | 'alert' | 'critical';

interface ComputedState {
  daysStale: number | null;
  severity: Severity;
  asOfText: string;
  ageText: string;
}

const SEVERITY_INLINE: Record<Severity, string> = {
  warning:
    'bg-pastel-butter/15 ring-1 ring-pastel-butter/40 text-pastel-butter',
  alert:
    'bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft',
  critical:
    'bg-red-500/15 ring-1 ring-red-500/40 text-red-300',
};

const SEVERITY_BLOCK: Record<Severity, string> = {
  warning:
    'bg-pastel-butter/10 ring-1 ring-pastel-butter/30 text-pastel-butter',
  alert:
    'bg-pastel-orange/10 ring-1 ring-pastel-orange/30 text-pastel-orange-soft',
  critical:
    'bg-red-500/10 ring-1 ring-red-500/30 text-red-300',
};

const SEVERITY_PREFIX: Record<Severity, string> = {
  warning: 'Stale',
  alert: 'Outdated',
  critical: 'Very outdated',
};

function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pluralizeDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'} ago`;
}

function compute(asOf: string | Date | null | undefined, thresholdDays: number): ComputedState | null {
  if (!asOf) {
    return {
      daysStale: null,
      severity: 'critical',
      asOfText: 'Unknown',
      ageText: 'Update timestamp unavailable',
    };
  }

  const d = typeof asOf === 'string' ? new Date(asOf) : asOf;
  if (Number.isNaN(d.getTime())) {
    return {
      daysStale: null,
      severity: 'critical',
      asOfText: 'Unknown',
      ageText: 'Update timestamp unavailable',
    };
  }

  const daysStale = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));

  if (daysStale < thresholdDays) {
    return null;
  }

  let severity: Severity;
  if (daysStale < thresholdDays * 2) {
    severity = 'warning';
  } else if (daysStale < thresholdDays * 6) {
    severity = 'alert';
  } else {
    severity = 'critical';
  }

  return {
    daysStale,
    severity,
    asOfText: formatDateShort(d),
    ageText: pluralizeDays(daysStale),
  };
}

export function StaleDataBadge({
  asOf,
  thresholdDays = 14,
  variant = 'inline',
  label,
  className,
}: StaleDataBadgeProps) {
  const state = useMemo(() => compute(asOf, thresholdDays), [asOf, thresholdDays]);
  if (!state) return null;

  const { severity, asOfText, ageText } = state;
  const ariaLabel = label
    ? `${label}. ${asOfText}, ${ageText}.`
    : `Data last updated ${asOfText} (${ageText}).`;

  if (variant === 'block') {
    return (
      <div
        role="note"
        aria-label={ariaLabel}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2',
          SEVERITY_BLOCK[severity],
          className,
        )}
      >
        <span className="font-jbmono text-[10px] uppercase tracking-[0.22em] font-bold flex-shrink-0">
          {SEVERITY_PREFIX[severity]}
        </span>
        <span className="font-sans text-[12px] leading-tight">
          {label ?? 'Last updated'}
          <span className="font-jbmono tabular-nums font-semibold ml-1">{asOfText}</span>
          <span className="text-white/55"> · {ageText}</span>
        </span>
      </div>
    );
  }

  return (
    <span
      role="note"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1.5',
        'font-jbmono text-[9px] uppercase tracking-[0.22em] font-bold',
        'rounded-md px-1.5 py-0.5',
        SEVERITY_INLINE[severity],
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="w-2.5 h-2.5 flex-shrink-0"
        fill="currentColor"
      >
        <circle cx="6" cy="6" r="6" opacity="0.25" />
        <circle cx="6" cy="6" r="2" />
      </svg>
      <span>
        {SEVERITY_PREFIX[severity]} · {ageText}
      </span>
    </span>
  );
}
