import { describe, expect, it, beforeEach } from 'vitest';
import { releaseStrandedPointerLock } from '../RouteUnlock';

describe('releaseStrandedPointerLock', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.pointerEvents = '';
  });

  it('lifts a pointer lock that no open dialog justifies', () => {
    document.body.style.pointerEvents = 'none';
    expect(releaseStrandedPointerLock()).toBe(true);
    expect(document.body.style.pointerEvents).toBe('');
  });

  it('leaves the lock alone while a dialog is open', () => {
    document.body.style.pointerEvents = 'none';
    document.body.innerHTML = '<div role="dialog" data-state="open"></div>';
    expect(releaseStrandedPointerLock()).toBe(false);
    expect(document.body.style.pointerEvents).toBe('none');
  });

  it('is a no-op when nothing is locked', () => {
    expect(releaseStrandedPointerLock()).toBe(false);
    expect(document.body.style.pointerEvents).toBe('');
  });
});
