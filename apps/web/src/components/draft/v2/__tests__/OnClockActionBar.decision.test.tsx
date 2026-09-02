/**
 * DECISION SUPPORT ON THE CLOCK (2026-09-02).
 *
 * `OnClockActionBar.test.tsx` pins what the bar has always done: the
 * countdown, the name, the Draft button's enabled state and the
 * double-submit guard. This file pins the three things it now SAYS, and the
 * more important half of that contract: what it says when the payload behind
 * those things is unavailable, which is every guest and every demo visitor.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { OnClockActionBar } from '../OnClockActionBar';
import type { Player } from '@/services/PlayerService';
import type { DraftProjection, PositionScarcity, QualitySignal } from '@/components/draft/draftDecision';

function mkPlayer(over: Partial<Player> = {}): Player {
  return {
    id: '8478402',
    full_name: 'Connor McDavid',
    position: 'C',
    eligible_positions: ['C'],
    team: 'EDM',
    jersey_number: null,
    status: null,
    headshot_url: null,
    last_updated: null,
    games_played: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plus_minus: 0,
    shots: 0,
    hits: 0,
    blocks: 0,
    xGoals: 0,
    wins: null,
    losses: null,
    ot_losses: null,
    saves: null,
    goals_against_average: null,
    save_percentage: null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
    ...over,
  } as Player;
}

const PROJECTION: DraftProjection = { total: 214.6, perGp: 10.73, gamesRemaining: 20 };
const SIGNAL: QualitySignal = {
  metric: 'xG/60',
  shortMetric: 'xG',
  percentile: 88,
  cohortNoun: 'forwards',
  cohortSize: 601,
  lowSample: false,
  value: '0.92',
};
const SCARCITY: PositionScarcity[] = [
  { position: 'G', startersLeft: 2, openSlots: 1, urgent: true },
  { position: 'D', startersLeft: 14, openSlots: 3, urgent: false },
];

const base = {
  amIOnClock: true,
  currentPickDeadline: new Date(Date.now() + 30_000).toISOString(),
  onDraft: vi.fn(),
  pickNumber: 24,
  roundNumber: 2,
};

afterEach(cleanup);

describe('the bar carries the numbers a pick turns on', () => {
  it('prints the projection, its per-game rate and the cohort percentile', () => {
    render(
      <OnClockActionBar
        {...base}
        selectedPlayer={mkPlayer()}
        projection={PROJECTION}
        signal={SIGNAL}
      />,
    );
    const line = screen.getByTestId('on-clock-decision-line').textContent ?? '';
    expect(line).toContain('214.6 proj');
    expect(line).toContain('10.7/gm over 20');
    // The cohort survives; the raw value moves to the title, because the
    // full line measured 391px inside a 353px bar at 393.
    expect(line).toContain('xG/60 88th of forwards');
    expect(line).not.toContain('0.92');
    expect(
      screen.getByTestId('on-clock-decision-line').getAttribute('title'),
    ).toContain('xG/60 0.92, 88th percentile of 601 forwards');
  });

  it('names the source, and claims nothing about accuracy', () => {
    render(
      <OnClockActionBar {...base} selectedPlayer={mkPlayer()} projection={PROJECTION} />,
    );
    const title = screen.getByTestId('on-clock-decision-line').getAttribute('title') ?? '';
    expect(title).toContain('Citrus projection, rest of season');
    for (const word of ['accurate', 'accuracy', 'best', 'most', 'guarantee']) {
      expect(title.toLowerCase()).not.toContain(word);
    }
  });

  it('degrades to nothing when the payload is unavailable (the guest path)', () => {
    render(<OnClockActionBar {...base} selectedPlayer={mkPlayer()} />);
    expect(screen.queryByTestId('on-clock-decision-line')).toBeNull();
    // ...and the bar still works: the name and the armed Draft button remain.
    expect(screen.getByText('Connor McDavid')).toBeInTheDocument();
    expect((screen.getByTestId('on-clock-draft-button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the projection alone when the player has no advanced read', () => {
    render(
      <OnClockActionBar {...base} selectedPlayer={mkPlayer()} projection={PROJECTION} />,
    );
    const line = screen.getByTestId('on-clock-decision-line').textContent ?? '';
    expect(line).toContain('214.6 proj');
    expect(line).not.toContain('xG');
  });

  it('flags a thin sample rather than presenting it as settled', () => {
    render(
      <OnClockActionBar
        {...base}
        selectedPlayer={mkPlayer()}
        signal={{ ...SIGNAL, lowSample: true }}
      />,
    );
    expect(screen.getByTestId('on-clock-decision-line').textContent).toContain('thin sample');
  });
});

describe('the scarcity strip', () => {
  it('renders before a player is selected, because that is when it helps', () => {
    render(<OnClockActionBar {...base} selectedPlayer={null} scarcity={SCARCITY} />);
    const chips = screen.getAllByTestId('on-clock-scarcity-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['G 2', 'D 14']);
  });

  it('marks the position where the run is on', () => {
    render(<OnClockActionBar {...base} selectedPlayer={null} scarcity={SCARCITY} />);
    const chips = screen.getAllByTestId('on-clock-scarcity-chip');
    expect(chips[0].getAttribute('data-urgent')).toBe('true');
    expect(chips[1].getAttribute('data-urgent')).toBe('false');
  });

  it('spells out the count and the open slots in the title', () => {
    render(<OnClockActionBar {...base} selectedPlayer={null} scarcity={SCARCITY} />);
    const title = screen.getAllByTestId('on-clock-scarcity-chip')[0].getAttribute('title') ?? '';
    expect(title).toContain('2 startable G left');
    expect(title).toContain('1 G slot open');
  });

  it('renders nothing when there is no scarcity data', () => {
    render(<OnClockActionBar {...base} selectedPlayer={null} />);
    expect(screen.queryByTestId('on-clock-scarcity')).toBeNull();
  });
});

describe('the copy survives a 393px phone', () => {
  it('the empty-selection prompt is not truncated away', () => {
    // It shipped as a single `truncate` line beside a large button and
    // rendered as "Select a ..." at 393px. It wraps now.
    render(<OnClockActionBar {...base} selectedPlayer={null} />);
    const prompt = screen.getByText(/select a player/i);
    expect(prompt.className).not.toContain('truncate');
    expect(prompt.textContent).toBe('Select a player, or tap Draft on any row.');
  });

  it('carries no em dash in any user-facing string', () => {
    render(
      <OnClockActionBar
        {...base}
        selectedPlayer={mkPlayer()}
        projection={PROJECTION}
        signal={SIGNAL}
        scarcity={SCARCITY}
      />,
    );
    const bar = screen.getByTestId('on-clock-action-bar');
    expect(bar.textContent).not.toContain('—');
    for (const el of bar.querySelectorAll('[title]')) {
      expect(el.getAttribute('title')).not.toContain('—');
    }
  });
});
