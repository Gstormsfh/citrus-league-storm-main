// Phase 4.5 chunk 11g.5b — PresenceDot tests.
// DR-4 (2026-07-30) — extended for 3-state (connected / away /
// not_connected) per architect ruling: show AWAY only for users
// observed leaving THIS session; never infer AWAY from absence.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceDot } from '../PresenceDot';
import { computePresenceStatus } from '../presenceStatus';
import { useDraftClientStore } from '@/stores/draftClientStore';

beforeEach(() => {
  useDraftClientStore.getState().reset();
});

describe('computePresenceStatus (DR-4 pure)', () => {
  it('returns connected when userId is in presentUserIds', () => {
    expect(
      computePresenceStatus('user-a', new Set(['user-a']), new Set()),
    ).toBe('connected');
  });

  it('returns away only when observed leaving this session', () => {
    expect(
      computePresenceStatus('user-a', new Set(), new Set(['user-a'])),
    ).toBe('away');
  });

  it('returns not_connected when not observed at all (never inferred AWAY)', () => {
    expect(computePresenceStatus('user-a', new Set(), new Set())).toBe(
      'not_connected',
    );
  });

  it('prefers connected over away when userId is in both (rejoin)', () => {
    expect(
      computePresenceStatus('user-a', new Set(['user-a']), new Set(['user-a'])),
    ).toBe('connected');
  });

  it('returns not_connected for null/undefined userId (unowned team)', () => {
    expect(computePresenceStatus(null, new Set(), new Set())).toBe(
      'not_connected',
    );
    expect(computePresenceStatus(undefined, new Set(), new Set())).toBe(
      'not_connected',
    );
  });
});

describe('PresenceDot component — 3-state DOM rendering', () => {
  it('renders GREEN (data-presence-status=connected) when user is present', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-1',
      presentUserIds: ['user-1'],
    });
    render(<PresenceDot userId="user-1" />);
    const dot = screen.getByTestId('presence-dot');
    expect(dot.getAttribute('data-presence-status')).toBe('connected');
    expect(dot.className).toMatch(/bg-green-500/);
    expect(dot.getAttribute('aria-label')).toContain('is connected');
  });

  it('renders AMBER (data-presence-status=away) when user observed leaving this session', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-1',
      presentUserIds: ['user-1'],
    });
    useDraftClientStore.getState().applyPresence({
      kind: 'left',
      userId: 'user-1',
      presentUserIds: [],
    });
    render(<PresenceDot userId="user-1" />);
    const dot = screen.getByTestId('presence-dot');
    expect(dot.getAttribute('data-presence-status')).toBe('away');
    expect(dot.className).toMatch(/bg-amber-500/);
    expect(dot.getAttribute('aria-label')).toContain('is away');
  });

  it('renders GREY (data-presence-status=not_connected) when never observed', () => {
    render(<PresenceDot userId="user-1" />);
    const dot = screen.getByTestId('presence-dot');
    expect(dot.getAttribute('data-presence-status')).toBe('not_connected');
    expect(dot.className).toMatch(/bg-gray-400/);
    expect(dot.getAttribute('aria-label')).toContain('is not connected');
  });

  it('renders GREY for null userId (unowned team, e.g. harness slot)', () => {
    render(<PresenceDot userId={null} />);
    const dot = screen.getByTestId('presence-dot');
    expect(dot.getAttribute('data-presence-status')).toBe('not_connected');
    expect(dot.className).toMatch(/bg-gray-400/);
  });

  it('rejoin flips back to GREEN (connected wins over away)', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-1',
      presentUserIds: ['user-1'],
    });
    useDraftClientStore.getState().applyPresence({
      kind: 'left',
      userId: 'user-1',
      presentUserIds: [],
    });
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-1',
      presentUserIds: ['user-1'],
    });
    render(<PresenceDot userId="user-1" />);
    expect(
      screen.getByTestId('presence-dot').getAttribute('data-presence-status'),
    ).toBe('connected');
  });

  it('passes through className for layout overrides', () => {
    render(<PresenceDot userId="user-1" className="ml-2 absolute" />);
    const dot = screen.getByTestId('presence-dot');
    expect(dot.className).toMatch(/ml-2/);
    expect(dot.className).toMatch(/absolute/);
  });
});
