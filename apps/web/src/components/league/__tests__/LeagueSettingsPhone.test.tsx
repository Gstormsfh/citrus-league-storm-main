// LEAGUE SETTINGS ON A PHONE (2026-09-04) — artboard 1a's commissioner screen.
//
// The fields are the builder's; this pins how the screen draws them: the
// header and chips, a value row that opens a picker and shows the choice
// the moment it closes, a number row that opens the stepper, a toggle that
// writes straight through, a locked section with no save bar, and the
// save bar that goes to the section's own save when it has one.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LeagueSettingsPhone } from '../LeagueSettingsPhone';
import type { SettingSection } from '../leagueSettingsSections';

afterEach(() => {
  cleanup();
});

const sections = (over: Partial<SettingSection>[] = []): SettingSection[] => {
  const base: SettingSection[] = [
    {
      key: 'waivers',
      label: 'WAIVERS',
      saveable: true,
      callout: 'Saving notifies all 12 managers.',
      groups: [
        {
          key: 'processing',
          label: 'PROCESSING',
          fields: [
            {
              kind: 'select',
              key: 'period',
              label: 'Waiver period',
              help: 'How long dropped players sit on waivers',
              value: '48',
              options: [
                { value: '24', label: '24 hours' },
                { value: '48', label: '48 hours' },
              ],
              onChange: vi.fn(),
            },
            { kind: 'number', key: 'budget', label: 'FAAB budget', value: 100, min: 1, max: 1000, step: 10, unit: '$', onChange: vi.fn() },
            { kind: 'toggle', key: 'lock', label: 'Game lock', help: 'Players lock at puck drop', checked: true, onChange: vi.fn() },
            { kind: 'action', key: 'run', label: 'Process waivers now', actionLabel: 'RUN', onPress: vi.fn() },
          ],
        },
      ],
    },
    {
      key: 'draft',
      label: 'DRAFT',
      saveable: false,
      callout: 'The draft is complete.',
      groups: [
        { key: 'd', label: 'THE DRAFT', fields: [{ kind: 'number', key: 'rounds', label: 'Rounds', value: 21, min: 1, max: 30, onChange: vi.fn(), disabled: true }] },
      ],
    },
    {
      key: 'rosters',
      label: 'ROSTERS',
      saveable: false,
      groups: [{ key: 't', label: '2 TEAMS', fields: [{ kind: 'info', key: 'a', label: 'Puck Heads', value: '18 players' }] }],
    },
  ];
  return base.map((s, i) => ({ ...s, ...(over[i] ?? {}) }));
};

const mount = (props: Partial<React.ComponentProps<typeof LeagueSettingsPhone>> = {}) => {
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  const onSectionChange = vi.fn();
  const utils = render(
    <LeagueSettingsPhone
      open
      onOpenChange={() => undefined}
      leagueName="Finalsz"
      sections={sections()}
      activeKey="waivers"
      onSectionChange={onSectionChange}
      onSave={onSave}
      onDiscard={onDiscard}
      {...props}
    />,
  );
  return { ...utils, onSave, onDiscard, onSectionChange };
};

describe('LeagueSettingsPhone', () => {
  it('draws the header, the section chips, and every row with its value', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('League settings');
    expect(screen.getByText('COMMISSIONER · FINALSZ')).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Settings section' });
    expect(chips.querySelectorAll('button')).toHaveLength(3);
    expect(chips.querySelector('[aria-pressed="true"]')).toHaveTextContent('WAIVERS');
    expect(screen.getByText('48 hours')).toBeInTheDocument();
    expect(screen.getByText('$100')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Game lock' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'RUN' })).toBeInTheDocument();
    expect(screen.getByText('Saving notifies all 12 managers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SAVE & NOTIFY LEAGUE' })).toBeInTheDocument();
  });

  it('a value row opens the option picker; choosing writes through and closes it', () => {
    const s = sections();
    const period = s[0].groups[0].fields[0];
    mount({ sections: s });
    fireEvent.click(screen.getByRole('button', { name: /Waiver period/ }));
    const list = screen.getByRole('listbox', { name: 'Waiver period' });
    expect(list.querySelector('[aria-selected="true"]')).toHaveTextContent('48 hours');
    fireEvent.click(screen.getByRole('option', { name: /24 hours/ }));
    expect(period.kind === 'select' && period.onChange).toHaveBeenCalledWith('24');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a number row opens the stepper; DONE commits the clamped, stepped figure', () => {
    const s = sections();
    const budget = s[0].groups[0].fields[1];
    mount({ sections: s });
    fireEvent.click(screen.getByRole('button', { name: /FAAB budget/ }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'DONE' }));
    expect(budget.kind === 'number' && budget.onChange).toHaveBeenCalledWith(120);
  });

  it('a toggle writes straight through; an action fires its handler', () => {
    const s = sections();
    const lock = s[0].groups[0].fields[2];
    const run = s[0].groups[0].fields[3];
    mount({ sections: s });
    fireEvent.click(screen.getByRole('switch', { name: 'Game lock' }));
    expect(lock.kind === 'toggle' && lock.onChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'RUN' }));
    expect(run.kind === 'action' && run.onPress).toHaveBeenCalledTimes(1);
  });

  it('a locked section shows its rows dimmed with no chevron and no save bar', () => {
    mount({ activeKey: 'draft' });
    expect(screen.queryByRole('button', { name: /Rounds/ })).toBeNull();
    expect(screen.getByText('Rounds')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SAVE & NOTIFY LEAGUE' })).toBeNull();
    expect(screen.getByText('The draft is complete.')).toBeInTheDocument();
  });

  it('a fact row carries no chevron; the save bar goes to the dashboard, or the section when it has its own', () => {
    const { onSave, onDiscard } = mount({ activeKey: 'rosters' });
    expect(screen.getByText('18 players')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Puck Heads/ })).toBeNull();
    cleanup();

    const own = vi.fn();
    const s = sections([{ onSave: own, saveDisabled: true }]);
    const second = mount({ sections: s });
    const save = screen.getByRole('button', { name: 'SAVE & NOTIFY LEAGUE' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }));
    expect(second.onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('the chips change the section through the caller', () => {
    const { onSectionChange } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'DRAFT' }));
    expect(onSectionChange).toHaveBeenCalledWith('draft');
  });
});
