/**
 * `DraftPoolRow` — the phone draft-pool row.
 *
 * The contract that matters is what the row SAYS, and what it refuses to say
 * when the payload behind it is unavailable. jsdom has no layout engine, so
 * the geometry findings that produced this row live in the harness and in
 * `draftDecisionSupportGuard`; these are the behavioural halves.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DraftPoolRow } from '../DraftPoolRow';
import type { Player } from '@/services/PlayerService';
import type { DraftProjection, QualitySignal } from '../draftDecision';

function mkPlayer(over: Partial<Player> = {}): Player {
  return {
    id: '8478402',
    full_name: 'Connor McDavid',
    position: 'C',
    eligible_positions: ['C'],
    team: 'EDM',
    jersey_number: '97',
    status: null,
    headshot_url: null,
    last_updated: null,
    games_played: 60,
    goals: 30,
    assists: 50,
    points: 80,
    plus_minus: 12,
    shots: 200,
    hits: 30,
    blocks: 20,
    xGoals: 25,
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

const PROJECTION: DraftProjection = { total: 214.6, perGp: 10.7, gamesRemaining: 20 };
const SIGNAL: QualitySignal = {
  metric: 'xG/60',
  shortMetric: 'xG',
  percentile: 88,
  cohortNoun: 'forwards',
  cohortSize: 601,
  lowSample: false,
  value: '0.92',
};

const base = {
  rank: 1,
  player: mkPlayer(),
  seasonFpts: 732.8,
  projection: null as DraftProjection | null,
  signal: null as QualitySignal | null,
  selected: false,
  drafted: false,
  queued: false,
  canDraft: false,
  submitting: false,
  onSelect: vi.fn(),
  onDraft: vi.fn(),
};

afterEach(cleanup);

describe('DraftPoolRow — the number the row leads with', () => {
  it('leads with the projection, labelled as a projection', () => {
    render(<DraftPoolRow {...base} projection={PROJECTION} />);
    expect(screen.getByTestId('draft-pool-projection').textContent).toBe('214.6');
    expect(screen.getByTestId('draft-pool-projection-label').textContent).toBe('proj');
  });

  it('falls back to season fantasy points, and SAYS it is season points', () => {
    // A guest's 401 leaves every projection null. The row must not label last
    // season's total "proj" — that is the same number wearing a different,
    // false claim.
    render(<DraftPoolRow {...base} projection={null} />);
    expect(screen.getByTestId('draft-pool-projection').textContent).toBe('732.8');
    expect(screen.getByTestId('draft-pool-projection-label').textContent).toBe('fpts');
  });
});

describe('DraftPoolRow — the quality signal', () => {
  it('prints the short metric and the percentile, with the cohort in the title', () => {
    render(<DraftPoolRow {...base} signal={SIGNAL} />);
    const el = screen.getByTestId('draft-pool-signal');
    expect(el.textContent).toBe('xG 88th');
    expect(el.getAttribute('title')).toContain('601 forwards');
    expect(el.getAttribute('title')).toContain('Citrus model');
  });

  it('marks a thin sample rather than presenting it as a settled read', () => {
    render(<DraftPoolRow {...base} signal={{ ...SIGNAL, lowSample: true }} />);
    expect(screen.getByTestId('draft-pool-signal').textContent).toBe('xG 88th*');
    expect(screen.getByTestId('draft-pool-signal').getAttribute('title')).toContain('Thin sample');
  });

  it('renders nothing at all when there is no signal', () => {
    render(<DraftPoolRow {...base} signal={null} />);
    expect(screen.queryByTestId('draft-pool-signal')).toBeNull();
  });

  it('never carries an em dash, which the copy rules ban', () => {
    render(<DraftPoolRow {...base} signal={SIGNAL} />);
    expect(screen.getByTestId('draft-pool-signal').getAttribute('title')).not.toContain('—');
  });
});

describe('DraftPoolRow — the controls', () => {
  it('shows the card button off the clock and stands it down on the clock', () => {
    // Under the clock the row itself carries the projection and the
    // percentile, which is what the card was being opened for, and the name
    // needs the 32px back.
    const { rerender } = render(<DraftPoolRow {...base} onShowCard={vi.fn()} canDraft={false} />);
    expect(screen.getByTestId('pool-row-card-button')).toBeInTheDocument();
    rerender(<DraftPoolRow {...base} onShowCard={vi.fn()} canDraft={true} />);
    expect(screen.queryByTestId('pool-row-card-button')).toBeNull();
  });

  it('omits the card button entirely when the caller passes no handler', () => {
    render(<DraftPoolRow {...base} />);
    expect(screen.queryByTestId('pool-row-card-button')).toBeNull();
  });

  it('opens the card without selecting the row (stopPropagation contract)', () => {
    const onShowCard = vi.fn();
    const onSelect = vi.fn();
    render(<DraftPoolRow {...base} onShowCard={onShowCard} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('pool-row-card-button'));
    expect(onShowCard).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('queues without selecting, and reports its pressed state', () => {
    const onToggleQueue = vi.fn();
    const onSelect = vi.fn();
    render(
      <DraftPoolRow {...base} queued onToggleQueue={onToggleQueue} onSelect={onSelect} />,
    );
    const star = screen.getByTestId('pool-queue-star');
    expect(star.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(star);
    expect(onToggleQueue).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('drafts in ONE tap when the Draft button is showing', () => {
    const onDraft = vi.fn();
    render(<DraftPoolRow {...base} canDraft onDraft={onDraft} />);
    fireEvent.click(screen.getByTestId('pool-row-draft-button'));
    expect(onDraft).toHaveBeenCalledTimes(1);
  });

  it('disables the Draft button while a pick is in flight (F11 double-submit guard)', () => {
    const onDraft = vi.fn();
    render(<DraftPoolRow {...base} canDraft submitting onDraft={onDraft} />);
    const btn = screen.getByTestId('pool-row-draft-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Submitting…');
    fireEvent.click(btn);
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('a drafted row does not select', () => {
    const onSelect = vi.fn();
    render(<DraftPoolRow {...base} drafted onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('draft-pool-row'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('DraftPoolRow — identity', () => {
  it('renders the full name, never an abbreviation', () => {
    render(<DraftPoolRow {...base} />);
    expect(screen.getByText('Connor McDavid')).toBeInTheDocument();
  });

  it('keeps a face in the box when the headshot CDN fails', () => {
    // `Mug` falls back headshot -> crest -> initials and always renders one
    // of the three. The row this replaced used a bare <img> that set
    // display:none on error, so a failed CDN left a hole and reflowed the
    // row. With no headshot_url and a real team code this lands on the crest.
    const { container } = render(<DraftPoolRow {...base} />);
    const mug = container.querySelector('[data-mug-state]');
    expect(mug).not.toBeNull();
    expect(['image', 'crest', 'initials']).toContain(mug!.getAttribute('data-mug-state'));
  });

  it('falls all the way to initials when there is no usable team code either', () => {
    const { container } = render(<DraftPoolRow {...base} player={mkPlayer({ team: '' })} />);
    expect(container.querySelector('[data-mug-state]')!.getAttribute('data-mug-state')).toBe(
      'initials',
    );
    expect(screen.getByLabelText('Connor McDavid')).toBeInTheDocument();
  });

  it('carries the availability chip when a player is not active', () => {
    render(<DraftPoolRow {...base} player={mkPlayer({ status: 'IR' })} />);
    expect(screen.getByTestId('draft-pool-status-chip').textContent).toBe('IR');
  });

  it('shows no chip for an active player', () => {
    render(<DraftPoolRow {...base} player={mkPlayer({ status: 'ACT' })} />);
    expect(screen.queryByTestId('draft-pool-status-chip')).toBeNull();
  });
});

describe('DraftPoolRow — the Players-row cut (2026-09-05, artboard 4a)', () => {
  it('prints the season line after the team, and the position rank after the read', () => {
    render(<DraftPoolRow {...base} signal={SIGNAL} seasonLine="90 PTS · 26:10" positionRank="D1" />);
    expect(screen.getByTestId('draft-pool-season').textContent).toBe('90 PTS · 26:10');
    const meta = screen.getByTestId('draft-pool-signal').parentElement!;
    expect(meta.textContent).toContain('xG 88th');
    expect(meta.textContent).toContain('D1');
  });

  it('draws neither when the caller has neither', () => {
    render(<DraftPoolRow {...base} signal={null} />);
    expect(screen.queryByTestId('draft-pool-season')).toBeNull();
    expect(screen.queryByText(/D1/)).toBeNull();
  });
});
