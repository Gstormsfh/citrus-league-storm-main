/**
 * INSTANT PLAYER CARDS (2026-09-01) — iPhone sim: "the player cards take
 * a while to load up to see the tabs." Every player-card opener (Roster,
 * Free Agents, Matchup) AWAITED a network fetch before opening the
 * dialog: a tap produced a full round trip of nothing, then a popped
 * modal. Yahoo/Sleeper open the card instantly from the data the row
 * already renders and let fresh numbers arrive in place.
 *
 * The contract: in every handlePlayerClick, setIsPlayerDialogOpen(true)
 * comes BEFORE the first await, and the background refresh guards
 * against enriching a card the user has already switched away from.
 *
 * jsdom has no network; these are source contracts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

const PAGES: Array<[string, string]> = [
  ['Roster', read('../pages/Roster.tsx')],
  ['FreeAgents', read('../pages/FreeAgents.tsx')],
  ['Matchup', read('../pages/Matchup.tsx')],
];

function handlerBlock(src: string): string {
  const start = src.indexOf('const handlePlayerClick');
  expect(start, 'handlePlayerClick missing').toBeGreaterThan(-1);
  // The handler ends before the next top-level const/function after it;
  // a generous slice is fine for ordering assertions.
  return src.slice(start, start + 2500);
}

describe('player cards open before any network round trip', () => {
  it.each(PAGES)('%s opens the dialog before the first await', (_name, src) => {
    const block = handlerBlock(src);
    const opens = block.indexOf('setIsPlayerDialogOpen(true)');
    const firstAwait = block.indexOf('await ');
    expect(opens, 'handler never opens the dialog').toBeGreaterThan(-1);
    expect(firstAwait, 'handler should still refresh in the background').toBeGreaterThan(-1);
    expect(opens, 'the dialog must open BEFORE the first await').toBeLessThan(firstAwait);
  });

  it.each(PAGES)('%s guards the background refresh against a switched card', (_name, src) => {
    const block = handlerBlock(src);
    expect(block).toMatch(/setSelectedPlayer\(prev =>/);
    expect(block).toMatch(/String\(prev\.id\) === String\(player\.id\)/);
  });
});

describe('the pure row-to-card mapper exists for instant opens', () => {
  it('playerStatsHelper exports servicePlayerToHockeyPlayer', () => {
    const helper = read('../utils/playerStatsHelper.ts');
    expect(helper).toMatch(/export function servicePlayerToHockeyPlayer\(player: Player\): HockeyPlayer/);
    // The async fetcher delegates to the same mapper — one stat mapping,
    // not two that can drift.
    expect(helper).toMatch(/return servicePlayerToHockeyPlayer\(player\);/);
  });
});
