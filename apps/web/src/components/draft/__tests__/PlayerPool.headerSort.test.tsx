/**
 * DESKTOP POOL SORTING (2026-09-14, Garrett's draft-room list, items 6-7).
 *
 * The "Sort By" select that duplicated every column header is gone from the
 * desktop card; the headers are the sort. And `#` finally honours its
 * direction: it used to flip the arrow and leave the order untouched.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { DEFAULT_SCORING } from '@citrus/shared';
import { PlayerPool } from '../PlayerPool';
import type { Player } from '@/services/PlayerService';

afterEach(cleanup);

function mkPlayer(id: string, over: Partial<Player> = {}): Player {
  return {
    id, full_name: `Player ${id}`, position: 'C', eligible_positions: ['C'], team: 'BOS', jersey_number: null,
    status: null, headshot_url: null, last_updated: null, games_played: 10, goals: 5, assists: 5, points: 10,
    plus_minus: 0, shots: 20, hits: 5, blocks: 3, xGoals: 4, wins: null, losses: null, ot_losses: null, saves: null,
    goals_against_average: null, save_percentage: null, highDangerSavePct: 0, goalsSavedAboveExpected: 0, ...over,
  };
}

// Projections decide rank: Charlie #1, Alpha #2, Bravo #3. Names deliberately
// disagree with rank so the two sorts are distinguishable.
const POOL = [
  mkPlayer('101', { full_name: 'Alpha', team: 'EDM', position: 'D', games_played: 30 }),
  mkPlayer('102', { full_name: 'Bravo', team: 'CGY', position: 'LW', games_played: 10 }),
  mkPlayer('103', { full_name: 'Charlie', team: 'BOS', position: 'C', games_played: 20 }),
];
const PROJ = new Map([
  ['103', { total: 300, perGp: 4, gamesRemaining: 75 }],
  ['101', { total: 200, perGp: 3, gamesRemaining: 75 }],
  ['102', { total: 100, perGp: 2, gamesRemaining: 75 }],
]);

function renderPool() {
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
}

/** Names in the desktop table, top to bottom. */
function tableOrder(): string[] {
  const table = document.querySelector('table')!;
  return [...table.querySelectorAll('tbody tr')].map((tr) => within(tr as HTMLElement).getAllByText(/Alpha|Bravo|Charlie/)[0].textContent!);
}
const header = (label: string) => within(document.querySelector('thead')!).getByText(label).closest('th')!;

describe('PlayerPool desktop — the headers are the sort', () => {
  it('has no "Sort By" select on the desktop card', () => {
    renderPool();
    expect(screen.queryByText('Sort By')).toBeNull();
    expect(screen.queryByText('Overall Rank (#1 →)')).toBeNull();
  });

  it('opens on rank #1 first, and clicking # flips to #N first — and back', () => {
    renderPool();
    expect(tableOrder()).toEqual(['Charlie', 'Alpha', 'Bravo']);
    fireEvent.click(header('#'));
    expect(tableOrder()).toEqual(['Bravo', 'Alpha', 'Charlie']);
    fireEvent.click(header('#'));
    expect(tableOrder()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('Player, Pos, Team and GP headers sort; text columns start A→Z, GP starts high first', () => {
    renderPool();
    fireEvent.click(header('Player'));
    expect(tableOrder()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    fireEvent.click(header('Player'));
    expect(tableOrder()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    fireEvent.click(header('Team'));
    expect(tableOrder()).toEqual(['Charlie', 'Bravo', 'Alpha']); // BOS, CGY, EDM
    fireEvent.click(header('Pos'));
    expect(tableOrder()).toEqual(['Charlie', 'Alpha', 'Bravo']); // C, D, LW
    fireEvent.click(header('GP'));
    expect(tableOrder()).toEqual(['Alpha', 'Charlie', 'Bravo']); // 30, 20, 10
  });

  it('a stat header still starts best-first and flips on the second click', () => {
    renderPool();
    fireEvent.click(header('Proj ROS'));
    expect(tableOrder()).toEqual(['Charlie', 'Alpha', 'Bravo']);
    fireEvent.click(header('Proj ROS'));
    expect(tableOrder()).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  it('pins # and Player at the same 40px seam and gives Actions its own width', () => {
    renderPool();
    const rank = header('#');
    const player = header('Player');
    expect(rank.className).toMatch(/\bw-10\b/);
    expect(rank.className).toMatch(/min-w-10/);
    expect(player.className).toMatch(/\bleft-10\b/);
    expect(player.className).not.toMatch(/left-\[44px\]/);
    const actions = within(document.querySelector('thead')!).getByText('Actions').closest('th')!;
    expect(actions.className).toMatch(/min-w-\[124px\]/);
  });
});
