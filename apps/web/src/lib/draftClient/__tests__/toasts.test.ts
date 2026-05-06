// Phase 4.5 chunk 11g.5b — toast helper tests.
//
// Mocks `sonner`'s `toast` API so tests can assert on what message
// would render without actually rendering. Covers the rejection-
// reason mapping and the 5s presence throttle.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock sonner before module-loading the helpers ─────────────────
//
// vi.hoisted hoists the mock-state initialization above any imports
// in the file (vitest's vi.mock is auto-hoisted, but factory bodies
// can't reference module-scope variables that haven't been
// initialized yet).

const { toastFn, toastError, toastSuccess } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, {
    error: toastError,
    success: toastSuccess,
  }),
}));

import {
  notifyPickRejected,
  notifyPresenceJoined,
  notifyPresenceLeft,
  notifyConnectionFatal,
  PRESENCE_TOAST_THROTTLE_MS,
  _resetPresenceThrottleForTests,
} from '../toasts';

beforeEach(() => {
  toastFn.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  _resetPresenceThrottleForTests();
});

// ── notifyPickRejected ────────────────────────────────────────────

describe('notifyPickRejected (chunk 11g.5b)', () => {
  it('maps not_on_clock to a user-facing message', () => {
    const result = notifyPickRejected('not_on_clock');
    expect(result).toMatch(/Someone else picked/);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/Someone else picked/),
    );
  });

  it('maps player_taken to a user-facing message', () => {
    const result = notifyPickRejected('player_taken');
    expect(result).toMatch(/just taken/);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('maps each typed reason to a non-null message (except dev-only)', () => {
    const userFacing: Array<Parameters<typeof notifyPickRejected>[0]> = [
      'not_on_clock',
      'player_taken',
      'pick_out_of_order',
      'unauthorized',
      'invalid_state',
      'idempotency_conflict',
      'internal_error',
      'invalid_payload',
    ];
    for (const reason of userFacing) {
      toastError.mockClear();
      const result = notifyPickRejected(reason);
      expect(result).not.toBeNull();
      expect(toastError).toHaveBeenCalledTimes(1);
    }
  });

  it('suppresses dev-only reasons silently (no toast, returns null)', () => {
    expect(notifyPickRejected('not_yet_implemented_chunk_11g6')).toBeNull();
    expect(notifyPickRejected('wrong_format_for_action')).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });
});

// ── Presence throttle ──────────────────────────────────────────────

describe('Presence toast throttle (5s window per chunk 11g.5b brief)', () => {
  it('first join in a window fires a toast (returns true)', () => {
    expect(notifyPresenceJoined('user-1')).toBe(true);
    expect(toastFn).toHaveBeenCalledTimes(1);
  });

  it('second join within 5s window is silenced (returns false, no toast)', () => {
    notifyPresenceJoined('user-1');
    toastFn.mockClear();
    expect(notifyPresenceJoined('user-2')).toBe(false);
    expect(toastFn).not.toHaveBeenCalled();
  });

  it('join after 5s window fires another toast', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    try {
      _resetPresenceThrottleForTests();
      expect(notifyPresenceJoined('user-1')).toBe(true);
      vi.advanceTimersByTime(PRESENCE_TOAST_THROTTLE_MS + 100);
      expect(notifyPresenceJoined('user-2')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('join and leave share the same throttle window', () => {
    notifyPresenceJoined('user-1'); // fires
    expect(notifyPresenceLeft('user-2')).toBe(false); // throttled
  });

  it('truncates long userIds in the toast message for readability', () => {
    notifyPresenceJoined('1234567890abcdef-very-long-uuid');
    expect(toastFn).toHaveBeenCalledWith(
      expect.stringMatching(/^12345678…/),
    );
  });
});

// ── notifyConnectionFatal ──────────────────────────────────────────

describe('notifyConnectionFatal', () => {
  it('renders a persistent error toast with title and description', () => {
    notifyConnectionFatal('auth_failure', 'Token expired');
    expect(toastError).toHaveBeenCalledWith(
      'Authorization expired',
      expect.objectContaining({
        description: 'Token expired',
        duration: Infinity,
      }),
    );
  });

  it('uses appropriate title per fatal reason', () => {
    notifyConnectionFatal('invalid_lobby', 'Draft completed');
    expect(toastError).toHaveBeenCalledWith(
      'Draft unavailable',
      expect.any(Object),
    );
    notifyConnectionFatal('permanent_server_error', 'Internal');
    expect(toastError).toHaveBeenCalledWith(
      'Connection error',
      expect.any(Object),
    );
  });
});
