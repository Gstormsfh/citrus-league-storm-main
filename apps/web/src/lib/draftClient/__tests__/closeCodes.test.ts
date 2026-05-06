// Phase 4.5 chunk 11g.5a — close-code disposition tests.
//
// 5 tests covering each major code class: standard normal, standard
// transient, custom auth (4001-4099), custom lobby (4100-4199),
// custom server (4200+).

import { describe, it, expect } from 'vitest';
import { classifyCloseCode } from '../closeCodes';

describe('classifyCloseCode (chunk 11g.5a)', () => {
  it('1000/1001 are normal closures (caller-initiated or browser navigation)', () => {
    expect(classifyCloseCode(1000, '')).toBe('normal');
    expect(classifyCloseCode(1001, 'going_away')).toBe('normal');
  });

  it('1006/1011/1013 are transient (network drop / server error / backpressure)', () => {
    expect(classifyCloseCode(1006, '')).toBe('transient');
    expect(classifyCloseCode(1011, '')).toBe('transient');
    expect(classifyCloseCode(1013, 'backpressure')).toBe('transient');
  });

  it('4001-4099 are permanent_auth', () => {
    expect(classifyCloseCode(4001, 'token_expired')).toBe('permanent_auth');
    expect(classifyCloseCode(4050, '')).toBe('permanent_auth');
    expect(classifyCloseCode(4099, '')).toBe('permanent_auth');
  });

  it('4100-4199 are permanent_lobby', () => {
    expect(classifyCloseCode(4100, 'lobby_not_found')).toBe('permanent_lobby');
    expect(classifyCloseCode(4150, 'draft_completed')).toBe('permanent_lobby');
    expect(classifyCloseCode(4199, '')).toBe('permanent_lobby');
  });

  it('4200+ are permanent_server; codes outside known ranges are transient', () => {
    expect(classifyCloseCode(4200, '')).toBe('permanent_server');
    expect(classifyCloseCode(4500, '')).toBe('permanent_server');
    expect(classifyCloseCode(4999, '')).toBe('permanent_server');
    // 1009 (message too big), 1010 (extension required), etc. — not
    // explicitly classified, fall through to transient.
    expect(classifyCloseCode(1009, '')).toBe('transient');
    expect(classifyCloseCode(1010, '')).toBe('transient');
  });
});
