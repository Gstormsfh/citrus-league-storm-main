// T15 architect Entry 13 (2026-08-09) — MOCK / PRACTICE DRAFT MODE
// core factory (pure function, no I/O).
//
// PURPOSE
//   Build the payload that server-side createPracticeLeague uses to
//   INSERT the throwaway league row. Isolating the payload shape as
//   a pure function means the shape is testable offline and can be
//   invoked from any surface (client-side dry-run for UI preview,
//   server-side for real INSERT) without duplication.
//
// SCOPE (pre-ratified by architect Entry 13)
//   - Throwaway league: 1 human seat + 11 autopick seats.
//   - Marker: settings.practice = true (fixture-12 f27_native pattern).
//   - Scoring: DEFAULT_SCORING (deterministic; user does NOT override
//     during practice).
//   - Naming: "Practice — <ISO timestamp>" for uniqueness.
//   - Soft-delete lifecycle: is_deleted / deleted_at present but
//     false / null at creation (existing pattern).
//
// FEATURE FLAG
//   Consumers MUST check FEATURE_PRACTICE_DRAFT
//   (apps/web/src/lib/featureFlags.ts) before calling this factory.
//   Factory itself does NOT check the flag — factories are
//   flag-agnostic; the caller boundary owns feature-gating.

import { DEFAULT_SCORING, type ScoringSettings } from './scoring';

// ── Constants ─────────────────────────────────────────────────────

/**
 * Default team count for practice drafts (matches Citrus real-league
 * default). Overridable via options; kept as a constant so future
 * tuning is one place.
 */
export const PRACTICE_DRAFT_DEFAULT_TEAM_COUNT = 12;

/**
 * Default draft rounds for practice (matches Citrus 21-round default).
 */
export const PRACTICE_DRAFT_DEFAULT_ROUNDS = 21;

/**
 * Default pick time limit (seconds) — 30s per pick for practice so
 * the ritual is short. Overridable via options.
 */
export const PRACTICE_DRAFT_DEFAULT_PICK_SECONDS = 30;

// ── Types ─────────────────────────────────────────────────────────

export interface BuildPracticeLeagueOptions {
  /** Override the default 12-team count. */
  teamsCount?: number;
  /** Override the default 21 rounds. */
  draftRounds?: number;
  /** Override the default 30s pick timer. */
  pickTimeLimitSeconds?: number;
  /**
   * Override the deterministic ISO clock reading (test injection).
   * If omitted, uses `new Date().toISOString()` at call time.
   */
  now?: string;
}

/**
 * Shape of the league row payload for INSERT.
 *
 * Field names match `public.leagues` schema. `settings` is the
 * JSONB blob that carries the practice marker + timing config.
 */
export interface PracticeLeaguePayload {
  /** Practice league name — always unique via ISO timestamp. */
  name: string;
  /** User who initiated the practice (owner + commissioner). */
  commissioner_id: string;
  /** Team count for the throwaway league (default 12). */
  teams_count: number;
  /** Draft rounds (default 21). */
  draft_rounds: number;
  /** Deterministic default scoring — no user override for practice. */
  scoring_settings: ScoringSettings;
  /** draft_status starts NOT_STARTED; ignition immediately after INSERT. */
  draft_status: 'not_started';
  /**
   * JSONB settings blob carrying the practice marker + timing.
   * `practice: true` is the load-bearing guardrail marker per
   * DESIGN_T15_practice_draft_mode.md §3.
   */
  settings: {
    practice: true;
    pickTimeLimit: number;
    /** Marker for the timing configuration lineage. */
    createdFrom: 'practice_factory_v1';
  };
  /** Soft-delete lifecycle fields (existing league pattern). */
  is_deleted: false;
  deleted_at: null;
}

// ── The factory ───────────────────────────────────────────────────

/**
 * Build a practice-league payload for INSERT.
 *
 * Determinism: if `options.now` is provided, the naming uses that
 * value (test-injectable). Otherwise pulls `new Date().toISOString()`
 * at call time — the ONLY non-pure aspect. Consumers who need full
 * purity pass `options.now`.
 *
 * ID collisions: naming is `Practice — <ISO timestamp>`. ISO
 * timestamps at 1ms resolution collide only under sub-ms concurrent
 * calls from the same user, which the concurrency guard in
 * DESIGN_T15 §5 #7 already disallows (1 practice league per user).
 */
export function buildPracticeLeaguePayload(
  userId: string,
  options: BuildPracticeLeagueOptions = {},
): PracticeLeaguePayload {
  const now = options.now ?? new Date().toISOString();
  const teamsCount = options.teamsCount ?? PRACTICE_DRAFT_DEFAULT_TEAM_COUNT;
  const draftRounds = options.draftRounds ?? PRACTICE_DRAFT_DEFAULT_ROUNDS;
  const pickTimeLimit = options.pickTimeLimitSeconds ?? PRACTICE_DRAFT_DEFAULT_PICK_SECONDS;

  return {
    name: `Practice — ${now}`,
    commissioner_id: userId,
    teams_count: teamsCount,
    draft_rounds: draftRounds,
    scoring_settings: DEFAULT_SCORING,
    draft_status: 'not_started',
    settings: {
      practice: true,
      pickTimeLimit,
      createdFrom: 'practice_factory_v1',
    },
    is_deleted: false,
    deleted_at: null,
  };
}

/**
 * Type guard: returns true if a league row's `settings` blob
 * carries the practice marker. Used by aggregation queries to
 * filter practice leagues out.
 *
 * Accepts `unknown` because callers pass raw JSONB.
 */
export function isPracticeLeagueSettings(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false;
  const s = settings as { practice?: unknown };
  return s.practice === true;
}
