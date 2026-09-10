/**
 * WHAT THE APP MAY INTERRUPT YOU FOR (2026-09-09).
 *
 * The categories are stated once in @citrus/shared (`NOTIFICATION_CATEGORIES`)
 * and this screen draws them; the server decides whether to send by the
 * same keys. Nothing here names a category by hand, so a category added to
 * the shared file appears here without a second edit, and one removed
 * cannot linger as a switch that does nothing.
 *
 * TWO LAYERS, DELIBERATELY. The master switch at the top is
 * `profiles.push_notifications` and it outranks everything: off means
 * silence, whatever the rows say. The rows are `profiles.push_categories`,
 * which holds ONLY overrides — a row the manager never touched is absent
 * from the column and follows the category's default. Choosing "The usual"
 * therefore writes an EMPTY object, not thirteen falses, so a default we
 * change later reaches everyone who never had an opinion.
 *
 * Every switch saves on tap, like the account screen's existing push
 * switch: there is no draft state to lose and no Save button to forget.
 */
import { useMemo } from 'react';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRESETS,
  resolvePreferences,
  type NotificationCategory,
  type NotificationPreferences,
  type NotificationPreset,
} from '@citrus/shared';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxSheet } from '@/components/pressbox/Sheet';
import { PressBoxChips } from '@/components/pressbox/Chips';
import {
  PressBoxSettingsHeader,
  PressBoxSettingGroup,
  PressBoxSettingRow,
  PressBoxCallout,
} from '@/components/pressbox/Settings';

export interface NotificationPrefsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** profiles.push_notifications */
  masterOn: boolean;
  /** profiles.push_categories, overrides only. */
  prefs: NotificationPreferences | null | undefined;
  saving?: boolean;
  onMasterChange: (on: boolean) => void;
  /** Replace the whole overrides object. */
  onPrefsChange: (next: NotificationPreferences) => void;
}

const GROUPS = ['Draft', 'Trades', 'Roster', 'League', 'Matchup'] as const;

/**
 * Which preset, if any, the current overrides amount to. "The usual" is the
 * empty object by construction; the others match on every resolved value.
 * No match means the manager customised, and no chip is lit.
 */
export function presetOf(prefs: NotificationPreferences | null | undefined): NotificationPreset['key'] | null {
  const resolved = resolvePreferences(prefs);
  for (const preset of NOTIFICATION_PRESETS) {
    if (NOTIFICATION_CATEGORIES.every((c) => resolved[c.key] === preset.values[c.key])) return preset.key;
  }
  return null;
}

/**
 * The overrides that produce a preset. "The usual" is `{}`; any other preset
 * is written out only where it DIFFERS from the default, so the stored row
 * stays minimal and a future default change still reaches it where the
 * manager expressed no opinion.
 */
export function overridesFor(preset: NotificationPreset): NotificationPreferences {
  const out: NotificationPreferences = {};
  for (const c of NOTIFICATION_CATEGORIES) {
    if (preset.values[c.key] !== c.defaultOn) out[c.key] = preset.values[c.key];
  }
  return out;
}

export function NotificationPrefsSheet({
  open,
  onOpenChange,
  masterOn,
  prefs,
  saving = false,
  onMasterChange,
  onPrefsChange,
}: NotificationPrefsSheetProps) {
  const resolved = useMemo(() => resolvePreferences(prefs), [prefs]);
  const activePreset = useMemo(() => presetOf(prefs), [prefs]);

  const toggle = (key: NotificationCategory, on: boolean) => {
    const def = NOTIFICATION_CATEGORIES.find((c) => c.key === key);
    const next: NotificationPreferences = { ...(prefs ?? {}) };
    // Back to the default: drop the key rather than store a redundant value.
    if (def && on === def.defaultOn) delete next[key];
    else next[key] = on;
    onPrefsChange(next);
  };

  return (
    <PressBoxSheet open={open} onOpenChange={onOpenChange} title="Notifications" shape="full">
      <div data-testid="notification-prefs-sheet" className="flex flex-col flex-1 min-h-0">
        <PressBoxSettingsHeader
          title="Notifications"
          eyebrow="ACCOUNT · ALERTS"
          status={saving ? 'SAVING' : null}
          onBack={() => onOpenChange(false)}
        />

        <div className={cn(PB_TYPE, 'flex-1 min-h-0 overflow-y-auto px-3.5 pt-3.5 pb-8 flex flex-col gap-4')}>
          <PressBoxSettingGroup label="PUSH">
            <PressBoxSettingRow
              label="Push notifications"
              help={masterOn ? 'On. Pick what arrives below.' : 'Off. Nothing is sent, whatever is chosen below.'}
              checked={masterOn}
              onToggle={saving ? undefined : onMasterChange}
              last
            />
          </PressBoxSettingGroup>

          <div className={cn(!masterOn && 'opacity-50 pointer-events-none')} aria-disabled={!masterOn}>
            <div className="mb-2 font-plex font-semibold text-[10px] tracking-[0.18em] uppercase text-pressbox-text/45">
              Quick pick
            </div>
            <PressBoxChips
              chips={NOTIFICATION_PRESETS.map((p) => ({ key: p.key, label: p.label.toUpperCase() }))}
              activeKey={activePreset ?? ''}
              onSelect={(key) => {
                const preset = NOTIFICATION_PRESETS.find((p) => p.key === key);
                if (preset) onPrefsChange(overridesFor(preset));
              }}
              label="Notification presets"
              outlined
              className="w-max"
            />
            <p className="mt-2 font-barlow text-[11px] text-pressbox-text/50">
              {activePreset
                ? NOTIFICATION_PRESETS.find((p) => p.key === activePreset)?.help
                : 'Custom. Your own mix, set row by row.'}
            </p>
          </div>

          <div className={cn('flex flex-col gap-4', !masterOn && 'opacity-50 pointer-events-none')} aria-disabled={!masterOn}>
            {GROUPS.map((group) => {
              const rows = NOTIFICATION_CATEGORIES.filter((c) => c.group === group);
              if (rows.length === 0) return null;
              return (
                <PressBoxSettingGroup key={group} label={group.toUpperCase()}>
                  {rows.map((c, i) => (
                    <PressBoxSettingRow
                      key={c.key}
                      label={c.label}
                      help={c.help}
                      checked={resolved[c.key]}
                      onToggle={saving ? undefined : (on) => toggle(c.key, on)}
                      last={i === rows.length - 1}
                    />
                  ))}
                </PressBoxSettingGroup>
              );
            })}
          </div>

          <PressBoxCallout>
            Your turn in the draft is the one that costs you a player. Everything else waits until you look.
          </PressBoxCallout>
        </div>
      </div>
    </PressBoxSheet>
  );
}

export default NotificationPrefsSheet;
