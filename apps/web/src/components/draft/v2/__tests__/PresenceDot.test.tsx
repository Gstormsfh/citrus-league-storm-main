// Phase 4.5 chunk 11g.5b — PresenceDot tests.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceDot } from '../PresenceDot';
import { useDraftClientStore } from '@/stores/draftClientStore';

beforeEach(() => {
  useDraftClientStore.getState().reset();
});

describe('PresenceDot (chunk 11g.5b)', () => {
  it('renders green when userId is in presentUserIds', () => {
    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-1',
      presentUserIds: ['user-1'],
    });
    render(<PresenceDot userId="user-1" />);
    const dot = screen.getByRole('status');
    expect(dot).toHaveClass('bg-green-500');
    expect(dot).toHaveAttribute('aria-label', expect.stringMatching(/online/));
  });

  it('renders gray when userId is NOT in presentUserIds', () => {
    render(<PresenceDot userId="user-1" />);
    const dot = screen.getByRole('status');
    expect(dot).toHaveClass('bg-gray-400');
    expect(dot).toHaveAttribute('aria-label', expect.stringMatching(/offline/));
  });

  it('updates when presentUserIds changes (live re-render)', () => {
    const { rerender } = render(<PresenceDot userId="user-1" />);
    expect(screen.getByRole('status')).toHaveClass('bg-gray-400');

    useDraftClientStore.getState().applyPresence({
      kind: 'joined',
      userId: 'user-1',
      presentUserIds: ['user-1'],
    });
    rerender(<PresenceDot userId="user-1" />);
    expect(screen.getByRole('status')).toHaveClass('bg-green-500');
  });

  it('passes through className for layout overrides', () => {
    render(<PresenceDot userId="user-1" className="ml-2 absolute" />);
    expect(screen.getByRole('status')).toHaveClass('ml-2', 'absolute');
  });
});
