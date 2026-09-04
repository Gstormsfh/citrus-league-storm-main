/**
 * LEAGUE SETTINGS, THE PHONE SCREEN (artboard 1a, 2026-09-04).
 *
 * The commissioner's screen as the artboard draws it: `‹ LEAGUE SETTINGS`
 * over `COMMISSIONER · FINALSZ`, a chip row of sections, and then groups
 * of rows where every row shows its current value on the right and the
 * rule under its label. Tapping a value opens a picker — an option list or
 * a stepper — and the row shows the new value the instant it closes.
 * Nothing saves on tap: `DISCARD` and `SAVE & NOTIFY LEAGUE` sit at the
 * foot with the callout above them saying who is told.
 *
 * Every row here is a `SettingField` from `leagueSettingsSections.ts`, so
 * this file knows nothing about waivers or keepers — it knows how to draw
 * a select, a number, a toggle, an action and a fact, and which picker to
 * open for the first two. The dashboard builds the fields from its own
 * state and saves through its own handler; this screen is a view of it.
 *
 * Below `lg` only: LeagueDashboard mounts it in place of the desktop
 * dialog when `useIsMobile()` says so, since a portal cannot be hidden by
 * a responsive class.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxSheet } from '@/components/pressbox/Sheet';
import { PressBoxChips } from '@/components/pressbox/Chips';
import {
  PressBoxSettingsHeader,
  PressBoxSettingGroup,
  PressBoxSettingRow,
  PressBoxCallout,
  PressBoxSaveBar,
  PressBoxOptionSheet,
  PressBoxNumberSheet,
} from '@/components/pressbox/Settings';
import { optionLabel, type SettingField, type SettingSection } from './leagueSettingsSections';

export interface LeagueSettingsPhoneProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leagueName: string;
  sections: SettingSection[];
  activeKey: string;
  onSectionChange: (key: string) => void;
  onSave: () => void;
  saving?: boolean;
  onDiscard: () => void;
  /** `SAVED` after a save, in sage; nothing otherwise. */
  status?: string | null;
}

type Picker = { kind: 'select' | 'number'; key: string } | null;

export function LeagueSettingsPhone({
  open,
  onOpenChange,
  leagueName,
  sections,
  activeKey,
  onSectionChange,
  onSave,
  saving,
  onDiscard,
  status,
}: LeagueSettingsPhoneProps) {
  const [picker, setPicker] = useState<Picker>(null);
  const section = sections.find((s) => s.key === activeKey) ?? sections[0];
  // Eight chips do not fit a phone; the active one is always on screen.
  const chipsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const active = chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [open, section?.key]);
  const fields = section ? section.groups.flatMap((g) => g.fields) : [];
  const picked = picker ? fields.find((f) => f.key === picker.key) : undefined;

  const renderField = (f: SettingField, last: boolean) => {
    switch (f.kind) {
      case 'select':
        return (
          <PressBoxSettingRow
            key={f.key}
            label={f.label}
            help={f.help ?? f.options.find((o) => o.value === f.value)?.help ?? null}
            value={optionLabel(f.options, f.value)}
            onPress={() => setPicker({ kind: 'select', key: f.key })}
            disabled={f.disabled}
            last={last}
          />
        );
      case 'number':
        return (
          <PressBoxSettingRow
            key={f.key}
            label={f.label}
            help={f.help}
            value={f.unit === '$' ? `$${f.value}` : f.unit ? `${f.value}${f.unit}` : String(f.value)}
            onPress={() => setPicker({ kind: 'number', key: f.key })}
            disabled={f.disabled}
            last={last}
          />
        );
      case 'toggle':
        return (
          <PressBoxSettingRow key={f.key} label={f.label} help={f.help} checked={f.checked} onToggle={f.onChange} last={last} />
        );
      case 'action':
        return (
          <PressBoxSettingRow
            key={f.key}
            label={f.label}
            help={f.help}
            action={{ label: f.actionLabel, onPress: f.onPress, busy: f.busy }}
            last={last}
          />
        );
      case 'info':
        return <PressBoxSettingRow key={f.key} label={f.label} help={f.help} value={f.value} last={last} />;
    }
  };

  return (
    <PressBoxSheet open={open} onOpenChange={onOpenChange} title="League settings" shape="full">
      <div data-testid="league-settings-phone" className="flex flex-col flex-1 min-h-0">
        <PressBoxSettingsHeader
          title="League settings"
          eyebrow={`COMMISSIONER · ${leagueName.toUpperCase()}`}
          status={status}
          onBack={() => onOpenChange(false)}
        />

        <div ref={chipsRef} className="mt-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <PressBoxChips
            chips={sections.map((s) => ({ key: s.key, label: s.label }))}
            activeKey={section?.key ?? ''}
            onSelect={onSectionChange}
            label="Settings section"
            outlined
            className="w-max px-3.5"
          />
        </div>

        <div className={cn(PB_TYPE, 'flex-1 min-h-0 overflow-y-auto px-3.5 pt-3.5 pb-4 flex flex-col gap-4')}>
          {section?.groups.map((g) =>
            g.fields.length === 0 ? null : (
              <PressBoxSettingGroup key={g.key} label={g.label}>
                {g.fields.map((f, i) => renderField(f, i === g.fields.length - 1))}
              </PressBoxSettingGroup>
            ),
          )}
          {section?.callout && <PressBoxCallout>{section.callout}</PressBoxCallout>}
        </div>

        {section?.saveable && (
          <PressBoxSaveBar
            saveLabel={(section.saving ?? saving) ? 'SAVING…' : 'SAVE & NOTIFY LEAGUE'}
            saveDisabled={!!(section.saving ?? saving) || !!section.saveDisabled}
            onDiscard={onDiscard}
            onSave={section.onSave ?? onSave}
            className="flex-none px-3.5 pt-2 pb-[max(env(safe-area-inset-bottom),22px)] border-t border-white/[0.06] bg-pressbox-surface"
          />
        )}
      </div>

      {picked?.kind === 'select' && (
        <PressBoxOptionSheet
          open
          onOpenChange={(o) => !o && setPicker(null)}
          title={picked.label}
          help={picked.help}
          /* A value set elsewhere that the list does not offer stays
             choosable as itself rather than vanishing. */
          options={
            picked.options.some((o) => o.value === picked.value)
              ? picked.options
              : [{ value: picked.value, label: picked.value }, ...picked.options]
          }
          value={picked.value}
          onSelect={picked.onChange}
        />
      )}
      {picked?.kind === 'number' && (
        <PressBoxNumberSheet
          open
          onOpenChange={(o) => !o && setPicker(null)}
          title={picked.label}
          help={picked.help}
          value={picked.value}
          min={picked.min}
          max={picked.max}
          step={picked.step}
          unit={picked.unit}
          onCommit={picked.onChange}
        />
      )}
    </PressBoxSheet>
  );
}

export default LeagueSettingsPhone;
