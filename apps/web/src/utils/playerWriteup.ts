/**
 * MOVED TO `@citrus/shared` (2026-09-11).
 *
 * Every word a player card shows must be changeable with a server deploy,
 * never an App Store round trip. The 800-line engine that writes those
 * words now lives in `packages/shared/src/playerWriteup`, so the API server
 * can render the same object the browser used to render for itself, and
 * `GET /api/players/:playerId/xg-history` carries the result.
 *
 * The engine STAYS IN THE BUNDLE as the fallback. `PlayerStatsModal` reads
 * `data?.writeup ?? generatePlayerWriteup(player, extras)`: if the endpoint
 * 500s, times out or omits the field, the card renders exactly as it did
 * before. The two roster surfaces (`HockeyPlayerCard`, `MobileRosterList`)
 * never left local at all — they render a five-word availability chip in a
 * list, and a round trip per row for that is not a trade worth making.
 *
 * This file stays as the web app's import path so the three call sites and
 * `__tests__/playerWriteup.test.ts` do not move.
 */
export * from '@citrus/shared/playerWriteup';
