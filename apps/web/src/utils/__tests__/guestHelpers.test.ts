import { describe, it, expect, vi } from 'vitest';
import { isGuestMode, isActiveUser, shouldBlockGuestOperation } from '../guestHelpers';

// =============================================================================
// isGuestMode
// =============================================================================

describe('isGuestMode', () => {
  it('returns true for "guest" state', () => {
    expect(isGuestMode('guest')).toBe(true);
  });

  it('returns true for "logged-in-no-league" state', () => {
    expect(isGuestMode('logged-in-no-league')).toBe(true);
  });

  it('returns false for "active-user" state', () => {
    expect(isGuestMode('active-user')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isGuestMode(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isGuestMode(undefined)).toBe(false);
  });
});

// =============================================================================
// isActiveUser
// =============================================================================

describe('isActiveUser', () => {
  it('returns true for "active-user" state', () => {
    expect(isActiveUser('active-user')).toBe(true);
  });

  it('returns false for "guest" state', () => {
    expect(isActiveUser('guest')).toBe(false);
  });

  it('returns false for "logged-in-no-league" state', () => {
    expect(isActiveUser('logged-in-no-league')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isActiveUser(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isActiveUser(undefined)).toBe(false);
  });
});

// =============================================================================
// shouldBlockGuestOperation
// =============================================================================

describe('shouldBlockGuestOperation', () => {
  it('returns true for "guest" state', () => {
    expect(shouldBlockGuestOperation('guest')).toBe(true);
  });

  it('returns true for "logged-in-no-league" state', () => {
    expect(shouldBlockGuestOperation('logged-in-no-league')).toBe(true);
  });

  it('returns false for "active-user" state', () => {
    expect(shouldBlockGuestOperation('active-user')).toBe(false);
  });

  it('returns false for null state', () => {
    expect(shouldBlockGuestOperation(null)).toBe(false);
  });

  it('returns false for undefined state', () => {
    expect(shouldBlockGuestOperation(undefined)).toBe(false);
  });

  it('calls showToast when blocking a guest operation', () => {
    const showToast = vi.fn();
    shouldBlockGuestOperation('guest', showToast);
    expect(showToast).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith('Please sign up to perform this action.');
  });

  it('calls showToast when blocking a logged-in-no-league operation', () => {
    const showToast = vi.fn();
    shouldBlockGuestOperation('logged-in-no-league', showToast);
    expect(showToast).toHaveBeenCalledOnce();
  });

  it('does not call showToast for active users', () => {
    const showToast = vi.fn();
    shouldBlockGuestOperation('active-user', showToast);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not throw when showToast is undefined and state is guest', () => {
    expect(() => shouldBlockGuestOperation('guest')).not.toThrow();
  });

  it('does not throw when showToast is undefined and state is active-user', () => {
    expect(() => shouldBlockGuestOperation('active-user')).not.toThrow();
  });
});
