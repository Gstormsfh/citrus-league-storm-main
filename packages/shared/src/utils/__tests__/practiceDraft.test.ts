// T15 architect Entry 13 — offline tests on the practice-draft factory.

import { describe, it, expect } from 'vitest';
import {
  buildPracticeLeaguePayload,
  isPracticeLeagueSettings,
  PRACTICE_DRAFT_DEFAULT_TEAM_COUNT,
  PRACTICE_DRAFT_DEFAULT_ROUNDS,
  PRACTICE_DRAFT_DEFAULT_PICK_SECONDS,
} from '../practiceDraft';
import { DEFAULT_SCORING } from '../scoring';

describe('buildPracticeLeaguePayload — shape', () => {
  it('emits a payload with all required fields', () => {
    const p = buildPracticeLeaguePayload('user-123', { now: '2026-08-09T04:30:00.000Z' });
    expect(p.commissioner_id).toBe('user-123');
    expect(p.teams_count).toBe(12);
    expect(p.draft_rounds).toBe(21);
    expect(p.draft_status).toBe('not_started');
    expect(p.scoring_settings).toBe(DEFAULT_SCORING);
    expect(p.is_deleted).toBe(false);
    expect(p.deleted_at).toBe(null);
  });

  it('carries the practice marker in settings JSONB', () => {
    const p = buildPracticeLeaguePayload('user-123', { now: '2026-08-09T04:30:00.000Z' });
    expect(p.settings.practice).toBe(true);
    expect(p.settings.createdFrom).toBe('practice_factory_v1');
  });

  it('name is deterministic when `now` is injected', () => {
    const p = buildPracticeLeaguePayload('user-123', { now: '2026-08-09T04:30:00.000Z' });
    expect(p.name).toBe('Practice — 2026-08-09T04:30:00.000Z');
  });

  it('default pickTimeLimit is 30 seconds (fast practice ritual)', () => {
    const p = buildPracticeLeaguePayload('user-123', { now: '2026-08-09T04:30:00.000Z' });
    expect(p.settings.pickTimeLimit).toBe(30);
    expect(PRACTICE_DRAFT_DEFAULT_PICK_SECONDS).toBe(30);
  });
});

describe('buildPracticeLeaguePayload — overrides', () => {
  it('honors teamsCount override', () => {
    const p = buildPracticeLeaguePayload('u', { now: 'T', teamsCount: 8 });
    expect(p.teams_count).toBe(8);
  });

  it('honors draftRounds override', () => {
    const p = buildPracticeLeaguePayload('u', { now: 'T', draftRounds: 15 });
    expect(p.draft_rounds).toBe(15);
  });

  it('honors pickTimeLimitSeconds override', () => {
    const p = buildPracticeLeaguePayload('u', { now: 'T', pickTimeLimitSeconds: 60 });
    expect(p.settings.pickTimeLimit).toBe(60);
  });
});

describe('buildPracticeLeaguePayload — defaults', () => {
  it('exports constants match runtime defaults', () => {
    expect(PRACTICE_DRAFT_DEFAULT_TEAM_COUNT).toBe(12);
    expect(PRACTICE_DRAFT_DEFAULT_ROUNDS).toBe(21);
    expect(PRACTICE_DRAFT_DEFAULT_PICK_SECONDS).toBe(30);
  });

  it('uses live clock when `now` is omitted (name has ISO Z suffix)', () => {
    const before = new Date().toISOString();
    const p = buildPracticeLeaguePayload('u');
    const after = new Date().toISOString();
    // Extract the ISO from the name and verify it's between before/after.
    const iso = p.name.replace(/^Practice — /, '');
    expect(iso >= before && iso <= after).toBe(true);
    expect(iso).toMatch(/Z$/);
  });

  it('two consecutive calls with different `now` produce different names', () => {
    const a = buildPracticeLeaguePayload('u', { now: '2026-08-09T04:30:00.000Z' });
    const b = buildPracticeLeaguePayload('u', { now: '2026-08-09T04:30:00.001Z' });
    expect(a.name).not.toBe(b.name);
  });
});

describe('isPracticeLeagueSettings — guardrail helper', () => {
  it('returns true when settings.practice === true', () => {
    expect(isPracticeLeagueSettings({ practice: true })).toBe(true);
  });

  it('returns false when settings.practice === false', () => {
    expect(isPracticeLeagueSettings({ practice: false })).toBe(false);
  });

  it('returns false when settings.practice is absent', () => {
    expect(isPracticeLeagueSettings({ pickTimeLimit: 30 })).toBe(false);
  });

  it('returns false for null / undefined / non-object inputs', () => {
    expect(isPracticeLeagueSettings(null)).toBe(false);
    expect(isPracticeLeagueSettings(undefined)).toBe(false);
    expect(isPracticeLeagueSettings('practice')).toBe(false);
    expect(isPracticeLeagueSettings(42)).toBe(false);
  });

  it('accepts real payload from buildPracticeLeaguePayload', () => {
    const p = buildPracticeLeaguePayload('u', { now: 'T' });
    expect(isPracticeLeagueSettings(p.settings)).toBe(true);
  });
});
