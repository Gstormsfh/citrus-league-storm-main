/**
 * MOVED TO `@citrus/shared` (2026-09-11).
 *
 * The percentile math went into the shared package when the player writeup
 * did: the server now computes a writeup's cohort reads against the full
 * qualified universe, and the client still computes the advanced card's
 * against the index it holds. Two copies of "where does this value sit in
 * its cohort" is exactly how two surfaces start printing two percentiles
 * for one player, so there is one copy and both sides import it.
 *
 * This file stays as the web app's import path so the three call sites and
 * `__tests__/playerPercentiles.test.ts` do not move. The module it points
 * at is byte-for-byte what used to live here, plus `COHORT_NOUN`.
 */
export * from '@citrus/shared/playerPercentiles';
