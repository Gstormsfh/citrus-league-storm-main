/**
 * The row, rendered.
 *
 * jsdom has no layout engine, so these do not check spacing; the harness at
 * `/harness/scores.html` is for that. What they check is the thing a unit
 * test CAN check and that matters most here: a scheduled row puts no score
 * digits on screen, however the server's zeros arrive.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ScoreboardGame, ScoresGameCitrus, ScoresPlayerLine } from '@citrus/shared';
import { ScoreboardGameRow } from '../ScoreboardGameRow';
import { ScoresEmptyDay } from '../ScoresEmptyDay';

const LINE = (over: Partial<ScoresPlayerLine> = {}): ScoresPlayerLine => ({
  playerId: 8480801,
  name: 'Brady Tkachuk',
  teamAbbrev: 'FLA',
  position: 'LW',
  isGoalie: false,
  headshotUrl: null,
  projectedPoints: 8.889,
  confidenceLabel: 'High',
  actualPoints: null,
  actuals: null,
  roster: null,
  ...over,
});

const CITRUS = (over: Partial<ScoresGameCitrus> = {}): ScoresGameCitrus => ({
  projectedPlayers: 49,
  players: [LINE()],
  rosteredCount: null,
  myCount: null,
  confidence: { high: 49, medium: 0, low: 0, unlabeled: 0 },
  hasActuals: false,
  ...over,
});

const GAME = (over: Partial<ScoreboardGame> = {}): ScoreboardGame => ({
  gameId: 2026020001,
  gameDate: '2026-09-29',
  startsAt: '2026-09-29T21:00:00+00:00',
  state: 'scheduled',
  statusRaw: 'scheduled',
  period: null,
  periodTime: null,
  venue: null,
  gameType: 'regular',
  season: 2026,
  away: { abbrev: 'FLA', teamId: 13, city: 'Florida', name: 'Panthers' },
  home: { abbrev: 'CAR', teamId: 12, city: 'Carolina', name: 'Hurricanes' },
  awayScore: null,
  homeScore: null,
  citrus: null,
  ...over,
});

describe('ScoreboardGameRow', () => {
  it('renders no score at all for a scheduled game, only the puck drop', () => {
    const { container } = render(
      <ScoreboardGameRow game={GAME()} expanded={false} onToggle={vi.fn()} />,
    );
    // The row's own text, minus the Citrus strip (absent here) and the chips.
    const text = container.textContent ?? '';
    expect(text).toContain('3:00 PM');
    // No standalone score digits anywhere in the row.
    expect(text).not.toMatch(/\b0\b/);
  });

  it('renders both scores once a game is live', () => {
    render(
      <ScoreboardGameRow
        game={GAME({ state: 'live', period: '3rd', periodTime: '00:42', awayScore: 2, homeScore: 3 })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('00:42 3rd')).toBeInTheDocument();
  });

  it('renders a genuinely scoreless live game as 0 and 0', () => {
    render(
      <ScoreboardGameRow
        game={GAME({ state: 'live', period: '1st', periodTime: '11:07', awayScore: 0, homeScore: 0 })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getAllByText('0')).toHaveLength(2);
  });

  it('labels a final that went past regulation', () => {
    render(
      <ScoreboardGameRow
        game={GAME({ state: 'final', period: 'OT', awayScore: 4, homeScore: 5 })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Final/OT')).toBeInTheDocument();
  });

  it('omits the Citrus strip entirely when nothing is projected', () => {
    render(<ScoreboardGameRow game={GAME()} expanded={false} onToggle={vi.fn()} />);
    expect(screen.queryByText(/Citrus/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/projected/i)).not.toBeInTheDocument();
  });

  it('shows the projection and its confidence when there are no actuals', () => {
    render(
      <ScoreboardGameRow game={GAME({ citrus: CITRUS() })} expanded={false} onToggle={vi.fn()} />,
    );
    // PRESS BOX (2026-09-04): the eyebrow is the artboards' word, `PROJECTED`.
    expect(screen.getByText('Projected')).toBeInTheDocument();
    expect(screen.getByText('8.9')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('49 projected')).toBeInTheDocument();
  });

  it('leads with the actual once a stat line exists, keeping the projection beside it', () => {
    render(
      <ScoreboardGameRow
        game={GAME({
          state: 'final',
          awayScore: 4,
          homeScore: 5,
          citrus: CITRUS({
            hasActuals: true,
            players: [LINE({ actualPoints: 16.6 })],
          }),
        })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Actual · projected')).toBeInTheDocument();
    expect(screen.getByText('16.6')).toBeInTheDocument();
    // `P 8.9` — the roster row's spelling of a projection beside an actual.
    expect(screen.getByText('P 8.9')).toBeInTheDocument();
  });

  it('says the starter is unknown when one club has two goalies projected', () => {
    render(
      <ScoreboardGameRow
        game={GAME({
          citrus: CITRUS({
            players: [
              LINE({ playerId: 8483548, name: 'Brandon Bussi', teamAbbrev: 'CAR', position: 'G', isGoalie: true }),
              LINE({ playerId: 8481611, name: 'Pyotr Kochetkov', teamAbbrev: 'CAR', position: 'G', isGoalie: true }),
            ],
          }),
        })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Two goalies projected for one club: the starter is not confirmed.'),
    ).toBeInTheDocument();
  });

  it('surfaces the raw status when the state is one we cannot read', () => {
    render(
      <ScoreboardGameRow
        game={GAME({ state: 'unknown', statusRaw: 'weather-hold' })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Status unavailable')).toBeInTheDocument();
    expect(screen.getByText('weather-hold')).toBeInTheDocument();
  });
});

describe('ScoresEmptyDay', () => {
  it('offers both neighbours as one tap each', () => {
    const onSelect = vi.fn();
    render(
      <ScoresEmptyDay nearest={{ before: '2026-06-14', after: '2026-09-29' }} onSelect={onSelect} />,
    );
    expect(screen.getByText('No games on this date')).toBeInTheDocument();
    screen.getByText('NEXT GAMES · SEP 29 ›').click();
    expect(onSelect).toHaveBeenCalledWith('2026-09-29');
    screen.getByText('‹ JUN 14').click();
    expect(onSelect).toHaveBeenCalledWith('2026-06-14');
  });

  it('renders without jump buttons when neither neighbour is known', () => {
    render(<ScoresEmptyDay nearest={{ before: null, after: null }} onSelect={vi.fn()} />);
    expect(screen.getByTestId('scores-empty-day')).toBeInTheDocument();
    expect(screen.queryByText(/NEXT GAMES/)).not.toBeInTheDocument();
  });
});
