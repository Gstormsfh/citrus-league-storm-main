/**
 * The trophy room's small parts, in the Press Box vocabulary: an eyebrow, a
 * panel, a row, a button. Tailwind on the pressbox tokens only.
 */
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('font-plex font-semibold text-[9px] tracking-[0.14em] uppercase text-pressbox-orange-soft', className)}>
      {children}
    </p>
  );
}

export function Panel({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn('rounded-[14px] bg-pressbox-tile ring-1 ring-white/[0.06] px-3.5 py-3', className)} data-testid={testId}>
      {children}
    </section>
  );
}

export function Row({ children, className, last }: { children: ReactNode; className?: string; last?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 py-2.5', !last && 'border-b border-white/[0.06]', className)}>
      {children}
    </div>
  );
}

export function Chip({ children, tone = 'cream' }: { children: ReactNode; tone?: 'cream' | 'orange' | 'sage' | 'grapefruit' }) {
  const tones = {
    cream: 'bg-white/[0.06] text-pressbox-text/80',
    orange: 'bg-pressbox-orange text-pressbox-orange-ink',
    sage: 'bg-pressbox-sage/20 text-pressbox-sage-soft',
    grapefruit: 'bg-pressbox-grapefruit/15 text-pressbox-grapefruit-text',
  } as const;
  return (
    <span className={cn('inline-flex items-center rounded-[6px] px-1.5 h-5 font-plex font-semibold text-[10px] tracking-[0.06em] uppercase', tones[tone])}>
      {children}
    </span>
  );
}

export interface HistoryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'primary' | 'quiet' | 'danger';
  busy?: boolean;
}

export function HistoryButton({ tone = 'primary', busy, className, children, disabled, ...rest }: HistoryButtonProps) {
  const tones = {
    primary: 'bg-pressbox-orange text-pressbox-orange-ink',
    quiet: 'border border-white/[0.12] bg-white/[0.03] text-pressbox-text/85',
    danger: 'bg-pressbox-grapefruit text-[#2a0a0f]',
  } as const;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-[10px] px-4 font-condensed font-bold text-[14px] uppercase tracking-[0.06em] disabled:opacity-40',
        tones[tone], className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const inputClass = 'w-full h-11 rounded-[10px] bg-white/[0.04] border border-white/[0.1] px-3 font-barlow text-[14px] text-pressbox-text placeholder:text-pressbox-text/40 focus:outline-none focus:ring-2 focus:ring-pressbox-orange/40';

export function EmptyState({ kicker, primary, context, action }: { kicker: string; primary: string; context?: string; action?: ReactNode }) {
  return (
    <div className="py-8 text-center" role="status">
      <Eyebrow>✦ {kicker}</Eyebrow>
      <p className="mt-2 font-condensed font-extrabold text-[22px] uppercase tracking-[0.02em] leading-none text-pressbox-text">{primary}</p>
      {context && <p className="mt-2 font-barlow text-[13px] leading-[1.45] text-white/55">{context}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
