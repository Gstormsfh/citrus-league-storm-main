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
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';

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
  /** `Rolling priority`. Renders with a chevron and makes the row tappable. */
  value?: string | null;
  onPress?: () => void;
  /** A switch instead of a value. */
  checked?: boolean;
  onToggle?: (next: boolean) => void;
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
  last,
  className,
}: PressBoxSettingRowProps) {
  const isSwitch = checked != null;
  const body = (
    <>
      <span className="min-w-0 text-left">
        <span className="block font-barlow font-semibold text-[14px] text-pressbox-text">{label}</span>
        {help && (
          <span className="block mt-px font-barlow text-[11px] text-pressbox-text/50">{help}</span>
        )}
      </span>
      {isSwitch ? (
        <PressBoxToggle checked={!!checked} onChange={onToggle} label={label} />
      ) : (
        <span className="flex items-center gap-1.5 flex-none font-plex font-medium text-[12px] text-pressbox-orange-soft">
          {value}
          <span aria-hidden="true" className="text-pressbox-text/40">
            &rsaquo;
          </span>
        </span>
      )}
    </>
  );

  const shell = cn(
    'flex items-center justify-between gap-3 px-3.5 py-3 w-full',
    !last && 'border-b border-white/[0.06]',
    className,
  );

  if (isSwitch || !onPress) {
    return <div className={shell}>{body}</div>;
  }
  return (
    <button type="button" onClick={onPress} className={cn(shell, 'focus-citrus text-left')}>
      {body}
    </button>
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
