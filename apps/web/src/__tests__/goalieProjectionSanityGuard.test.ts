/**
 * GOALIE-PROJ SANITY (2026-09-01) — the founder's hankering, confirmed:
 * a goalie's card promised "84 upcoming games" and a 619.5 TOTAL PROJ
 * that outranked every skater, because the game-log builder summed the
 * per-TEAM-game "if he starts" projections. The rest-of-season table
 * already carries start-aware numbers (top goalies 53–60 games).
 *
 * Contract: the card's goalie headline reads the ROS row (total +
 * projected starts) instead of the team-game sum; skaters keep the sum.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CARD = readFileSync(resolve(here, '../components/PlayerStatsModal.tsx'), 'utf-8');
const API = readFileSync(resolve(here, '../api/players.ts'), 'utf-8');

describe('goalie projections are start-aware on the player card', () => {
  it('the goalie branch reads the rest-of-season row', () => {
    const at = CARD.indexOf('if (playerIsGoalie) {');
    expect(at, 'goalie ROS branch missing').toBeGreaterThan(-1);
    const body = CARD.slice(at, at + 1200);
    expect(body).toContain('getRosProjectionForPlayer(playerId)');
    expect(body).toContain('goalieAwareTotal = rosTotal');
    expect(body).toContain('setGoalieStartsRemaining(');
  });

  it('the headline labels speak in projected starts, not team games', () => {
    expect(CARD).toContain('projected starts');
    expect(CARD).toContain('projected starts of ${futureGames.length} team games');
  });

  it('the api exposes the single-player ROS read', () => {
    expect(API).toContain('getRosProjectionForPlayer(playerId: string | number)');
    expect(API).toContain('/api/players/ros-projections?playerId=');
  });
});
