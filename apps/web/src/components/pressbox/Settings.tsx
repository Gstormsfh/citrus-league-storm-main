/**
 * THE LEAGUE SETTINGS SCREEN (artboard 1a).
 *
 * A commissioner screen, and the artboard treats it as one throughout. Three
 * decisions are worth naming because a settings page usually gets all three
 * wrong:
 *
 *   * EVERY ROW SHOWS ITS CURRENT VALUE, in orange, on the right. Not a
 *     chevron to a page that shows it. A commissioner opening this screen is
 *     almost always AUDITING — "what did we set waivers to" — not changing
 *     anything, and a list of labels with arrows answers none of that.
 *   * THE HELP LINE IS PART OF THE ROW. `Claimant drops to the back of the
 *     line` under `Waiver type` is not a tooltip and not a `?`. These are
 *     rules twelve people will argue about in March; the screen states them
 *     where the setting is, in 11px Barlow, and takes the vertical cost.
 *   * NOTHING SAVES ON TAP. `DISCARD` and `SAVE & NOTIFY LEAGUE` are pinned
 *     to the bottom, and the callout above them says who gets told and when
 *     it takes effect. A league setting changed silently mid-week is how a
 *     commissioner loses an argument they were right about.
 *
 * The save button says `SAVE & NOTIFY LEAGUE` rather than `SAVE` for the same
 * reason — the notification is not a side effect, it is half the action, and
 * the button names both.
 */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';
import { PressBoxSheet } from './Sheet';

/* ── header ────────────────────────────────────────────────────────── */

export interface PressBoxSettingsHeaderProps {
  title: string;
  /** `COMMISSIONER · FINALSZ`. */
  eyebrow?: string | null;
  /** `SAVED`, in sage. Absent shows nothing rather than `UNSAVED`. */
  status?: string | null;
  onBack?: () => void;
  className?: string;
}

export function PressBoxSettingsHeader({
  title,
  eyebrow,
  status,
  onBack,
  className,
}: PressBoxSettingsHeaderProps) {
  return (
    <header className={cn(PB_TYPE, 'flex items-center justify-between gap-2 px-3.5 py-2', className)}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="focus-citrus relative flex-none text-[18px] leading-none text-pressbox-text/70 after:absolute after:-inset-y-[13px] after:-inset-x-5 after:content-['']"
        >
          &lsaquo;
        </button>
      ) : (
        <span className="flex-none w-2" />
      )}

      <div className="text-center min-w-0">
        <h1 className="font-condensed font-extrabold text-[20px] uppercase tracking-[0.03em] text-pressbox-text truncate">
          {title}
        </h1>
        {eyebrow && (
          <p className="font-plex font-medium text-[9px] tracking-[0.14em] text-pressbox-orange-soft truncate">
            {eyebrow}
          </p>
        )}
      </div>

      <span className="flex-none font-plex font-semibold text-[11px] text-pressbox-sage">{status}</span>
    </header>
  );
}

/* ── group ─────────────────────────────────────────────────────────── */

export function PressBoxSettingGroup({
  label,
  children,
  className,
}: {
  label?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(PB_TYPE, className)}>
      {label && (
        <h2 className="px-0.5 pb-1.5 font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-text/45">
          {label}
        </h2>
      )}
      <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] overflow-hidden">
        {children}
      </div>
    </section>
  );
}

/* ── toggle ────────────────────────────────────────────────────────── */

export function PressBoxToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'focus-citrus relative flex-none w-11 h-[26px] rounded-[13px] transition-colors',
        checked ? 'bg-pressbox-sage' : 'bg-white/[0.14]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 w-[22px] h-[22px] rounded-full bg-pressbox-text transition-all',
          checked ? 'right-0.5' : 'right-[22px]',
        )}
      />
    </button>
  );
}

/* ── row ───────────────────────────────────────────────────────────── */

export interface PressBoxSettingRowProps {
  label: string;
  /** The rule, stated where the setting is. */
  help?: string | null;
  /**
   * `Rolling priority`. With `onPress` the row is tappable and carries a
   * chevron; without one it is a fact (`12 players`) and carries none.
   */
  value?: string | null;
  onPress?: () => void;
  /** A switch instead of a value. */
  checked?: boolean;
  onToggle?: (next: boolean) => void;
  /**
   * A small button instead of a value — `RUN`, `SYNC` — for the
   * commissioner tools that do something now rather than set something.
   */
  action?: { label: string; onPress: () => void; busy?: boolean };
  /** Locked (the draft is done). Shown at half strength, not tappable. */
  disabled?: boolean;
  /** Last row in a group drops its rule. */
  last?: boolean;
  className?: string;
}

export function PressBoxSettingRow({
  label,
  help,
  value,
  onPress,
  checked,
  onToggle,
  action,
  disabled,
  last,
  className,
}: PressBoxSettingRowProps) {
  const isSwitch = checked != null;
  const tappable = !!onPress && !disabled;
  const body = (
    <>
      <span className="min-w-0 text-left">
        <span className="block font-barlow font-semibold text-[14px] text-pressbox-text">{label}</span>
        {help && (
          <span className="block mt-px font-barlow text-[11px] text-pressbox-text/50">{help}</span>
        )}
      </span>
      {isSwitch ? (
        <PressBoxToggle checked={!!checked} onChange={disabled ? undefined : onToggle} label={label} />
      ) : action ? (
        <button
          type="button"
          onClick={action.onPress}
          disabled={action.busy || disabled}
          className="focus-citrus flex-none h-8 px-3 rounded-[8px] bg-white/[0.06] border border-white/[0.12] font-plex font-semibold text-[10px] tracking-[0.08em] text-pressbox-text disabled:opacity-50"
        >
          {action.label}
        </button>
      ) : (
        <span
          className={cn(
            'flex items-center gap-1.5 flex-none font-plex font-medium text-[12px] tabular-nums',
            tappable ? 'text-pressbox-orange-soft' : 'text-pressbox-text/70',
          )}
        >
          {value}
          {tappable && (
            <span aria-hidden="true" className="text-pressbox-text/40">
              &rsaquo;
            </span>
          )}
        </span>
      )}
    </>
  );

  const shell = cn(
    'flex items-center justify-between gap-3 px-3.5 py-3 w-full',
    !last && 'border-b border-white/[0.06]',
    disabled && 'opacity-50',
    className,
  );

  if (!tappable) {
    return <div className={shell}>{body}</div>;
  }
  return (
    <button type="button" onClick={onPress} className={cn(shell, 'focus-citrus text-left')}>
      {body}
    </button>
  );
}

/* ── pickers ───────────────────────────────────────────────────────── */

export interface PressBoxPickerOption {
  value: string;
  label: string;
  help?: string | null;
}

export interface PressBoxOptionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  help?: string | null;
  options: PressBoxPickerOption[];
  value: string;
  onSelect: (value: string) => void;
}

/**
 * The value picker behind a setting row. One row per option, the current
 * one marked, and choosing closes — the row it came from shows the new
 * value the instant the sheet is gone, which is the confirmation.
 */
export function PressBoxOptionSheet({ open, onOpenChange, title, help, options, value, onSelect }: PressBoxOptionSheetProps) {
  return (
    <PressBoxSheet open={open} onOpenChange={onOpenChange} title={title} shape="bottom">
      <div className="px-3.5 pt-3.5 pb-2">
        <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text">{title}</p>
        {help && <p className="mt-0.5 font-barlow text-[11px] text-pressbox-text/50">{help}</p>}
      </div>
      <div role="listbox" aria-label={title} className="overflow-y-auto px-3.5 pb-2">
        <div className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] overflow-hidden">
          {options.map((o, i) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onSelect(o.value);
                  onOpenChange(false);
                }}
                className={cn(
                  'focus-citrus flex items-center justify-between gap-3 w-full px-3.5 py-3 text-left',
                  i < options.length - 1 && 'border-b border-white/[0.06]',
                )}
              >
                <span className="min-w-0">
                  <span className={cn('block font-barlow font-semibold text-[14px]', active ? 'text-pressbox-text' : 'text-pressbox-text/85')}>
                    {o.label}
                  </span>
                  {o.help && <span className="block mt-px font-barlow text-[11px] text-pressbox-text/50">{o.help}</span>}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex-none w-5 h-5 rounded-full border flex items-center justify-center font-plex text-[11px]',
                    active ? 'bg-pressbox-sage border-pressbox-sage text-pressbox-surface' : 'border-white/[0.16]',
                  )}
                >
                  {active ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </PressBoxSheet>
  );
}

export interface PressBoxNumberSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  help?: string | null;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** `s`, `$`. */
  unit?: string;
  onCommit: (value: number) => void;
}

/**
 * The number picker: a stepper with the figure typed or nudged, committed
 * by DONE. `−`/`+` move by `step` and clamp; the field accepts anything
 * and clamps on commit, so a fat-fingered 900 rounds becomes the max
 * rather than an error.
 */
export function PressBoxNumberSheet({ open, onOpenChange, title, help, value, min, max, step = 1, unit, onCommit }: PressBoxNumberSheetProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    if (open) setDraft(String(value));
  }, [open, value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const current = Number(draft);
  const valid = Number.isFinite(current);
  const decimals = (String(step).split('.')[1] ?? '').length;
  const commit = () => {
    if (!valid) return;
    onCommit(Number(clamp(Math.round(current / step) * step).toFixed(decimals)));
    onOpenChange(false);
  };
  const nudge = (dir: 1 | -1) =>
    setDraft((d) => {
      const n = Number(d);
      return clamp((Number.isFinite(n) ? n : value) + dir * step).toFixed(decimals);
    });
  return (
    <PressBoxSheet open={open} onOpenChange={onOpenChange} title={title} shape="bottom">
      <div className="px-3.5 pt-3.5 pb-2">
        <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text">{title}</p>
        {help && <p className="mt-0.5 font-barlow text-[11px] text-pressbox-text/50">{help}</p>}
      </div>
      <div className="px-3.5 pb-2 flex items-center gap-2">
        <button
          type="button"
          aria-label="Less"
          onClick={() => nudge(-1)}
          className="focus-citrus flex-none w-12 h-12 rounded-[10px] bg-pressbox-tile border border-white/[0.08] font-plex text-[18px] text-pressbox-text"
        >
          −
        </button>
        <label className="flex-1 flex items-center justify-center gap-1 h-12 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
          <span className="sr-only">{title}</span>
          {unit === '$' && <span className="font-plex font-medium text-[14px] text-pressbox-text/50">$</span>}
          <input
            type="number"
            inputMode={step < 1 ? 'decimal' : 'numeric'}
            value={draft}
            min={min}
            max={max}
            step={step}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
            className="w-24 bg-transparent text-center font-plex font-semibold text-[20px] tabular-nums text-pressbox-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {unit && unit !== '$' && <span className="font-plex font-medium text-[14px] text-pressbox-text/50">{unit}</span>}
        </label>
        <button
          type="button"
          aria-label="More"
          onClick={() => nudge(1)}
          className="focus-citrus flex-none w-12 h-12 rounded-[10px] bg-pressbox-tile border border-white/[0.08] font-plex text-[18px] text-pressbox-text"
        >
          +
        </button>
      </div>
      <p className="px-3.5 font-plex font-medium text-[9px] tracking-[0.08em] text-pressbox-text/45">
        {min} TO {max}
        {step !== 1 ? ` · STEPS OF ${step}` : ''}
      </p>
      <div className="px-3.5 pt-3">
        <button
          type="button"
          onClick={commit}
          disabled={!valid}
          className="focus-citrus w-full h-11 rounded-[10px] bg-pressbox-orange font-plex font-semibold text-[12px] tracking-[0.06em] text-pressbox-orange-ink disabled:opacity-40"
        >
          DONE
        </button>
      </div>
    </PressBoxSheet>
  );
}

/* ── callout ───────────────────────────────────────────────────────── */

export function PressBoxCallout({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        PB_TYPE,
        'flex items-center gap-2.5 px-3.5 py-2.5 rounded-[12px]',
        'bg-pressbox-orange-soft/[0.08] border border-pressbox-orange-soft/30',
        className,
      )}
    >
      <span aria-hidden="true" className="flex-none text-[14px] text-pressbox-orange-soft">
        !
      </span>
      <p className="font-barlow text-[12px] leading-[1.4] text-pressbox-text/85">{children}</p>
    </div>
  );
}

/* ── save bar ──────────────────────────────────────────────────────── */

export interface PressBoxSaveBarProps {
  discardLabel?: string;
  saveLabel: string;
  onDiscard?: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  className?: string;
}

export function PressBoxSaveBar({
  discardLabel = 'DISCARD',
  saveLabel,
  onDiscard,
  onSave,
  saveDisabled,
  className,
}: PressBoxSaveBarProps) {
  return (
    <div
      className={cn(
        PB_TYPE,
        'flex gap-2 font-plex font-semibold text-[12px] tracking-[0.06em]',
        className,
      )}
    >
      <button
        type="button"
        onClick={onDiscard}
        className="focus-citrus flex-1 h-11 rounded-[10px] bg-white/[0.06] border border-white/[0.12] text-pressbox-text"
      >
        {discardLabel}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveDisabled}
        className="focus-citrus flex-[2] h-11 rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink disabled:opacity-40"
      >
        {saveLabel}
      </button>
    </div>
  );
}
