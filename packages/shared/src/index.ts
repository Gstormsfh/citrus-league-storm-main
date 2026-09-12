// Re-export everything from shared packages
export * from './types';
export * from './constants';
export * from './utils';

/**
 * The three pure modules that moved out of `apps/web` on 2026-09-11 so the
 * API server can render a player writeup: the writeup engine itself, the
 * cohort percentile math its comparison sentences need, and the league
 * projection scoring its projection sentence needs. Each also has a subpath
 * export (`@citrus/shared/playerWriteup`, ...) for the web shims that keep
 * the old import paths alive.
 */
export * from './playerWriteup';
export * from './seasonContext';
export * from './playerWriteup/fromIndex';
export * from './playerPercentiles';
export * from './leagueProjection';
