/**
 * STATUS ON THE DESKTOP LINE (2026-09-14, Garrett: "if a player is injured
 * it will show that on their line?").
 *
 * It did not. The phone row (DraftPoolRow) has drawn PlayerAvailabilityBadge
 * since the availability feed landed; the desktop table row never did, so on
 * the web an IR player looked exactly like a healthy one. Both rows now draw
 * the same badge under the same evidence rule: dated status shows, no
 * evidence shows nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import { DEFAULT_SCORING } from '@citrus/shared';
import type { PlayerAvailability } from '@citrus/shared';
import { PlayerPool } from '../PlayerPool';
import type { Player } from '@/services/PlayerService';

afterEach(cleanup);

const DAY = 86_400_000;
const dated = (status: PlayerAvailability['status'], daysAgo: number, expiresInDays: number): PlayerAvailability => ({
  status, basis: 'reported_status',
  as_of: new Date(Date.now() - daysAgo * DAY).toISOString(),
  expires_at: new Date(Date.now() + expiresInDays * DAY).toISOString(),
  source: 'espn-injuries', revision: '1', stale: false,
});

function mkPlayer(id: string, over: Partial<Player> = {}): Player {
  return {
    id, full_name: `Player ${id}`, position: 'C', eligible_positions: ['C'], team: 'BOS', jersey_number: null,
    status: null, headshot_url: null, last_updated: null, games_played: 10, goals: 5, assists: 5, points: 10,
    plus_minus: 0, shots: 20, hits: 5, blocks: 3, xGoals: 4, wins: null, losses: null, ot_losses: null, saves: null,
    goals_against_average: null, save_percentage: null, highDangerSavePct: 0, goalsSavedAboveExpected: 0, ...over,
  };
}

const POOL = [
  mkPlayer('201', { full_name: 'Healthy Harry', availability: dated('healthy', 1, 6) }),
  mkPlayer('202', { full_name: 'Injured Ivan', availability: dated('ir', 2, 5) }),
  mkPlayer('203', { full_name: 'Daily Dan', availability: dated('day_to_day', 0, 2) }),
  mkPlayer('204', { full_name: 'Silent Sam', availability: null }),
  mkPlayer('205', { full_name: 'Expired Eddie', availability: dated('injured', 20, -10) }),
];
const PROJ = new Map(POOL.map((p, i) => [p.id, { total: 300 - i * 10, perGp: 4, gamesRemaining: 75 }]));

const rowFor = (name: string) => {
  const cell = within(document.querySelector('table')!).getByText(name);
  return cell.closest('tr') as HTMLElement;
};
const badgeIn = (row: HTMLElement) => row.querySelector('[data-availability-status]');

describe('PlayerPool — the desktop row shows a player\'s status', () => {
  it('draws the availability badge beside the name for every dated status, and nothing without evidence', () => {
    render(
      <PlayerPool
        availablePlayers={POOL}
        onPlayerSelect={() => {}}
        onPlayerDraft={() => {}}
        selectedPlayer={null}
        draftedPlayers={[]}
        isDraftActive
        scoringReady
        scoringSettings={DEFAULT_SCORING}
        projectedFptsMap={PROJ}
      />,
    );
    expect(badgeIn(rowFor('Injured Ivan'))?.getAttribute('data-availability-status')).toBe('ir');
    expect(badgeIn(rowFor('Daily Dan'))?.getAttribute('data-availability-status')).toBe('day_to_day');
    expect(badgeIn(rowFor('Healthy Harry'))?.getAttribute('data-availability-status')).toBe('healthy');
    // No evidence is not a status. Neither is a report whose review window closed.
    expect(badgeIn(rowFor('Silent Sam'))).toBeNull();
    expect(badgeIn(rowFor('Expired Eddie'))).toBeNull();
  });
});
