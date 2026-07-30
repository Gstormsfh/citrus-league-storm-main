// DR-4 (2026-07-30) — ManagerPresencePanel tests.
//
// The visible surface for the DR-1 presence-count anomaly fix.
// Contract:
//   - Renders one row per team; connected count matches presentUserIds
//     intersected with owned teams
//   - Unowned teams (owner_id null) render with a neutral dot and "—"
//     status label; excluded from the connected total
//   - Row dots reflect the store's 3-state (connected/away/not_connected)
//   - Presence changes drive live re-render (store subscription)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ManagerPresencePanel } from '../ManagerPresencePanel';
import { useDraftClientStore } from '@/stores/draftClientStore';

beforeEach(() => {
  useDraftClientStore.getState().reset();
});

afterEach(() => {
  cleanup();
});

const TEAMS = [
  { id: 't-1', team_name: 'Alpha', owner_id: 'user-a' },
  { id: 't-2', team_name: 'Bravo', owner_id: 'user-b' },
  { id: 't-3', team_name: 'Charlie (unowned)', owner_id: null },
  { id: 't-4', team_name: 'Delta', owner_id: 'user-d' },
];

describe('ManagerPresencePanel', () => {
  it('renders one row per team with correct status labels', () => {
    // user-a connected, user-b never observed, user-d observed leaving
    act(() => {
      useDraftClientStore.getState().applyPresence({
        kind: 'joined',
        userId: 'user-a',
        presentUserIds: ['user-a', 'user-d'],
      });
      useDraftClientStore.getState().applyPresence({
        kind: 'left',
        userId: 'user-d',
        presentUserIds: ['user-a'],
      });
    });
    render(<ManagerPresencePanel teams={TEAMS} />);
    const rows = screen.getAllByTestId('manager-presence-row');
    expect(rows.length).toBe(4);

    // user-a → connected
    expect(rows[0].textContent).toContain('Alpha');
    expect(rows[0].textContent).toContain('connected');

    // user-b → not connected (never observed)
    expect(rows[1].textContent).toContain('Bravo');
    expect(rows[1].textContent).toContain('not connected');

    // Unowned → em-dash label
    expect(rows[2].textContent).toContain('Charlie');
    expect(rows[2].textContent).toContain('—');

    // user-d → away (observed leaving)
    expect(rows[3].textContent).toContain('Delta');
    expect(rows[3].textContent).toContain('away');
  });

  it('connected count matches presentUserIds intersected with owned teams', () => {
    act(() => {
      useDraftClientStore.getState().applyPresence({
        kind: 'joined',
        userId: 'user-a',
        presentUserIds: ['user-a', 'user-b'],
      });
    });
    render(<ManagerPresencePanel teams={TEAMS} />);
    // 2 of user-a/user-b are connected; 3 owned teams total; unowned
    // Charlie excluded from the denominator.
    const countLine = screen.getByTestId('manager-presence-count');
    expect(countLine.textContent).toContain('2 of 3 connected');
  });

  it('excludes unowned teams from the connected total', () => {
    render(<ManagerPresencePanel teams={TEAMS} />);
    const countLine = screen.getByTestId('manager-presence-count');
    expect(countLine.textContent).toContain('0 of 3 connected');
  });
});
