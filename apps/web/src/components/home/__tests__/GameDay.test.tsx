/**
 * Citrus Game Day (2026-09-05): every tile routes, to a type the create
 * screen accepts. See gameDayGames.ts.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PressBoxGameDay } from '../GameDay';
import { GAME_DAY_GAMES, GAME_DAY_JOIN_TO } from '../gameDayGames';

const here = dirname(fileURLToPath(import.meta.url));
const CREATE = readFileSync(resolve(here, '../../../pages/CreateLeague.tsx'), 'utf8');
const APP = readFileSync(resolve(here, '../../../App.tsx'), 'utf8');

describe('PressBoxGameDay', () => {
  it('three free-to-play tiles and the join line, each a link', () => {
    render(<MemoryRouter><PressBoxGameDay /></MemoryRouter>);
    const tiles = screen.getAllByTestId('game-day-tile');
    expect(tiles).toHaveLength(3);
    expect(tiles.map((t) => t.getAttribute('href'))).toEqual(GAME_DAY_GAMES.map((g) => g.to));
    expect(screen.getByText('FREE TO PLAY')).toBeTruthy();
    expect(screen.getByRole('link', { name: /join with a code/i }).getAttribute('href')).toBe(GAME_DAY_JOIN_TO);
  });

  it('every type is one the create screen selects from ?type=, on a route App.tsx serves', () => {
    expect(APP).toContain('path="/create-league"');
    for (const g of GAME_DAY_GAMES) {
      expect(g.to).toBe(`/create-league?type=${g.type}`);
      expect(CREATE, `${g.type} must be selected by ?type=`).toContain(`type === '${g.type}'`);
    }
  });
});
