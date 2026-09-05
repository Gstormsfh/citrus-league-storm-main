/**
 * THE SETTING FIELDS, DRAWN (2026-09-04).
 *
 * `leagueSettingsSections.ts` states a setting once as data; this is the
 * one place that turns a field into a row and a row's tap into a picker.
 * It was `renderField` inside LeagueSettingsPhone until Create League
 * needed the same rows for the same fields (a new league's settings are
 * the settings screen's settings, before there is a league), at which
 * point a second copy of the switch statement would have been the exact
 * thing the data module exists to prevent.
 *
 * `SettingFieldRows` draws the rows of one group and reports which one was
 * tapped; `SettingPicker` draws the sheet for the tapped field. A screen
 * holds the `Picker` state and passes it between them.
 */
import { PressBoxOptionSheet, PressBoxNumberSheet, PressBoxSettingRow, PressBoxTextRow } from '@/components/pressbox/Settings';
import { optionLabel, type SettingField } from './leagueSettingsSections';

export type SettingPickerState = { kind: 'select' | 'number'; key: string } | null;

export function SettingFieldRows({
  fields,
  onPick,
}: {
  fields: SettingField[];
  onPick: (picker: SettingPickerState) => void;
}) {
  return (
    <>
      {fields.map((f, i) => {
        const last = i === fields.length - 1;
        switch (f.kind) {
          case 'select':
            return (
              <PressBoxSettingRow
                key={f.key}
                label={f.label}
                help={f.help ?? f.options.find((o) => o.value === f.value)?.help ?? null}
                value={optionLabel(f.options, f.value)}
                onPress={() => onPick({ kind: 'select', key: f.key })}
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
                onPress={() => onPick({ kind: 'number', key: f.key })}
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
          case 'text':
            return (
              <PressBoxTextRow
                key={f.key}
                label={f.label}
                help={f.help}
                value={f.value}
                onChange={f.onChange}
                placeholder={f.placeholder}
                inputType={f.inputType}
                maxLength={f.maxLength}
                last={last}
              />
            );
        }
      })}
    </>
  );
}

/** The sheet for the tapped field, or nothing. */
export function SettingPicker({
  picker,
  fields,
  onClose,
}: {
  picker: SettingPickerState;
  fields: SettingField[];
  onClose: () => void;
}) {
  const picked = picker ? fields.find((f) => f.key === picker.key) : undefined;
  if (picked?.kind === 'select') {
    return (
      <PressBoxOptionSheet
        open
        onOpenChange={(o) => !o && onClose()}
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
    );
  }
  if (picked?.kind === 'number') {
    return (
      <PressBoxNumberSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={picked.label}
        help={picked.help}
        value={picked.value}
        min={picked.min}
        max={picked.max}
        step={picked.step}
        unit={picked.unit}
        onCommit={picked.onChange}
      />
    );
  }
  return null;
}
