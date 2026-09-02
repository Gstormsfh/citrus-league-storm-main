// Opponent-difficulty tint (2026-09-01, Sleeper parity audit M10).
//
// Sleeper colour-codes the opponent label by the quality of the expected
// matchup. Citrus has the number: `daily_projection.opponent_adjustment`,
// the multiplier the model applied for tonight's opponent. Below 0.95 the
// `vs/@ OPP` label goes sage (easier), above 1.05 orange-soft (tougher),
// default in between — and the projection tooltip carries a one-line
// legend, so the colour is never bare. Thresholds are pinned on the pure
// helper; the row and the tooltip are pinned on the DOM.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { PlayerCard } from '../PlayerCard';
import { ProjectionTooltip } from '../ProjectionTooltip';
import type { MatchupPlayer } from '../types';
import type { NHLGame } from '@/services/ScheduleService';
import {
  OPPONENT_EASY_BELOW,
  OPPONENT_TOUGH_ABOVE,
  OPPONENT_EASY_CLASS,
  OPPONENT_NEUTRAL_CLASS,
  OPPONENT_TOUGH_CLASS,
  opponentTier,
  opponentTint,
  opponentTierTooltipClass,
} from '../opponentTint';

const DATE = '2099-03-01';

const game = (over: Partial<NHLGame> = {}): NHLGame => ({
  id: 'g1',
  game_id: 1,
  game_date: DATE,
  game_time: '19:00',
  home_team: 'TOR',
  away_team: 'BOS',
  home_score: 0,
  away_score: 0,
  status: 'scheduled',
  period: null,
  period_time: null,
  venue: null,
  season: 2026,
  game_type: 'regular',
  ...over,
});

const projection = (adjustment: number): NonNullable<MatchupPlayer['daily_projection']> => ({
  total_projected_points: 4.2,
  projected_goals: 0.4,
  projected_assists: 0.5,
  projected_sog: 3.2,
  projected_blocks: 0.5,
  projected_xg: 0.4,
  base_ppg: 4,
  shrinkage_weight: 1,
  finishing_multiplier: 1,
  opponent_adjustment: adjustment,
  b2b_penalty: 1,
  home_away_adjustment: 1,
  confidence_score: 0.7,
  calculation_method: 'test',
});

const player = (over: Partial<MatchupPlayer> = {}): MatchupPlayer => ({
  id: 1,
  name: 'Auston Matthews',
  position: 'C',
  team: 'TOR',
  points: 0,
  gamesRemaining: 1,
  status: null,
  isStarter: true,
  stats: { goals: 0, assists: 0, sog: 0, blk: 0 },
  games: [game()],
  gameInfo: { opponent: 'vs BOS', time: '7:00 PM' },
  ...over,
});

const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
const opponentLabel = (c: HTMLElement) => c.querySelector('.player-opponent') as HTMLElement;

let originalWidth: number;
beforeEach(() => {
  originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
});
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth });
});

describe('opponentTint — thresholds', () => {
  it('pins the band: easy below 0.95, tough above 1.05, neutral between (inclusive)', () => {
    expect(OPPONENT_EASY_BELOW).toBe(0.95);
    expect(OPPONENT_TOUGH_ABOVE).toBe(1.05);
    expect(opponentTier(0.94)).toBe('easy');
    expect(opponentTier(0.949)).toBe('easy');
    expect(opponentTier(0.95)).toBe('neutral');
    expect(opponentTier(1.0)).toBe('neutral');
    expect(opponentTier(1.05)).toBe('neutral');
    expect(opponentTier(1.051)).toBe('tough');
    expect(opponentTier(1.2)).toBe('tough');
  });

  it('no data is no claim: missing, null, NaN and Infinity are neutral', () => {
    expect(opponentTier(undefined)).toBe('neutral');
    expect(opponentTier(null)).toBe('neutral');
    expect(opponentTier(Number.NaN)).toBe('neutral');
    expect(opponentTier(Number.POSITIVE_INFINITY)).toBe('neutral');
  });

  it('maps tiers to the app accents: sage easier, orange-soft tougher, the row default otherwise', () => {
    expect(opponentTint(0.9)).toEqual({ tier: 'easy', className: OPPONENT_EASY_CLASS, label: 'Easier' });
    expect(opponentTint(1.1)).toEqual({ tier: 'tough', className: OPPONENT_TOUGH_CLASS, label: 'Tougher' });
    expect(opponentTint(1.0)).toEqual({ tier: 'neutral', className: OPPONENT_NEUTRAL_CLASS, label: 'Average' });
    expect(OPPONENT_EASY_CLASS).toBe('text-pastel-sage');
    expect(OPPONENT_TOUGH_CLASS).toBe('text-pastel-orange-soft');
    // Never red/green — those mean LIVE and injury elsewhere in the app.
    for (const c of [OPPONENT_EASY_CLASS, OPPONENT_TOUGH_CLASS, OPPONENT_NEUTRAL_CLASS]) {
      expect(c).not.toMatch(/red|green|amber/);
    }
  });

  it('the tooltip surface is light, so its tier colours are the deep variants', () => {
    expect(opponentTierTooltipClass('easy')).toBe('text-pastel-forest-soft');
    expect(opponentTierTooltipClass('tough')).toBe('text-pastel-orange-deep');
    expect(opponentTierTooltipClass('neutral')).toBe('text-pastel-forest');
  });
});

describe('PlayerCard — the vs/@ OPP label wears the tint', () => {
  it('easier opponent: sage', () => {
    const { container } = render(
      <PlayerCard player={player({ daily_projection: projection(0.9) })} isUserTeam selectedDate={DATE} />,
    );
    const label = opponentLabel(container);
    expect(label.textContent).toBe('vs BOS');
    expect(label).toHaveAttribute('data-opponent-tier', 'easy');
    expect(label.className).toContain('text-pastel-sage');
    expect(label.className).not.toContain('text-white/60');
  });

  it('tougher opponent: orange-soft', () => {
    const { container } = render(
      <PlayerCard player={player({ daily_projection: projection(1.12) })} isUserTeam selectedDate={DATE} />,
    );
    const label = opponentLabel(container);
    expect(label).toHaveAttribute('data-opponent-tier', 'tough');
    expect(label.className).toContain('text-pastel-orange-soft');
  });

  it('average opponent, or no projection at all: the row default', () => {
    const avg = render(<PlayerCard player={player({ daily_projection: projection(1.0) })} isUserTeam selectedDate={DATE} />);
    expect(opponentLabel(avg.container)).toHaveAttribute('data-opponent-tier', 'neutral');
    expect(opponentLabel(avg.container).className).toContain('text-white/60');
    const none = render(<PlayerCard player={player({ id: 2 })} isUserTeam selectedDate={DATE} />);
    expect(opponentLabel(none.container)).toHaveAttribute('data-opponent-tier', 'neutral');
    expect(opponentLabel(none.container).className).not.toMatch(/text-pastel-(sage|orange)/);
  });

  it('the away prefix keeps the tint too', () => {
    const { container } = render(
      <PlayerCard
        player={player({ games: [game({ home_team: 'BOS', away_team: 'TOR' })], daily_projection: projection(0.8) })}
        isUserTeam
        selectedDate={DATE}
      />,
    );
    expect(opponentLabel(container).textContent).toBe('@ BOS');
    expect(opponentLabel(container).className).toContain('text-pastel-sage');
  });
});

describe('ProjectionTooltip — the legend explains the colour', () => {
  it('names the tier, the multiplier, and the two colours in one line', async () => {
    render(
      <ProjectionTooltip projection={projection(1.12)}>
        <span>4.2</span>
      </ProjectionTooltip>,
    );
    fireEvent.click(screen.getByRole('button'));
    const tier = await screen.findByTestId('projection-opponent-tier');
    expect(tier).toHaveTextContent('Tougher · ×1.12');
    expect(tier).toHaveAttribute('data-opponent-tier', 'tough');
    expect(tier.className).toContain('text-pastel-orange-deep');
    const legend = screen.getByTestId('projection-opponent-legend');
    expect(legend).toHaveTextContent(/sage = easier than average/);
    expect(legend).toHaveTextContent(/orange = tougher/);
    // The swatches are the row's actual colours.
    expect(legend.querySelector('.bg-pastel-sage')).toBeTruthy();
    expect(legend.querySelector('.bg-pastel-orange-soft')).toBeTruthy();
  });

  it('an easier opponent reads Easier in deep sage', async () => {
    render(
      <ProjectionTooltip projection={projection(0.88)}>
        <span>4.2</span>
      </ProjectionTooltip>,
    );
    fireEvent.click(screen.getByRole('button'));
    const tier = await screen.findByTestId('projection-opponent-tier');
    expect(tier).toHaveTextContent('Easier · ×0.88');
    expect(tier.className).toContain('text-pastel-forest-soft');
  });

  it('no multiplier on the projection: no opponent line, no legend to mislead', async () => {
    const p = { ...projection(1), opponent_adjustment: Number.NaN };
    render(
      <ProjectionTooltip projection={p}>
        <span>4.2</span>
      </ProjectionTooltip>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/Projected Stats/i)).toBeInTheDocument();
    expect(screen.queryByTestId('projection-opponent')).toBeNull();
  });
});
