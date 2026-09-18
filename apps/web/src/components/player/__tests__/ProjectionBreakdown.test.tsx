import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectionStatBreakdown, SeasonProjectionCard, UpcomingProjectionCards } from '../ProjectionBreakdown';
import { projectionContributions } from '../projectionContributions';
import { projectedSummary, scoreGameLog } from '../projectionScoring';
import type { GameLogEntry } from '../gameLogRows';

const row = { projected_goals: 2, projected_assists: 3, projected_sog: 5,
  projected_ppp: 1, projected_shp: 0, projected_hits: 4, projected_blocks: 2,
  projected_pim: 2, projected_plus_minus: -2 };
const scoring = { skater: { goals: 6, assists: 4, shots_on_goal: .9, power_play_points: 2,
  short_handed_points: 3, hits: 1, blocks: 1, penalty_minutes: -.5, plus_minus: 1 } };
describe('complete league projection breakdown', () => {
  afterEach(() => vi.useRealTimers());
  it('gives the league total the orange emphasis and names the preseason horizon', () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
    render(<SeasonProjectionCard row={{...row,games_remaining:80}} scoring={scoring} goalie={false} points />);
    expect(screen.getByText('Projected total fantasy points')).toBeInTheDocument();
    expect(screen.getByText('33.5')).toHaveClass('text-pressbox-orange');
    expect(screen.getByText('2026-27 projection')).toBeInTheDocument();
    expect(screen.getByText('80 projected games')).toBeInTheDocument();
  });
  it('does not fabricate fantasy totals for a categories league', () => {
    render(<SeasonProjectionCard row={{...row,games_remaining:80}} scoring={scoring} goalie={false} points={false} />);
    expect(screen.queryByText('Projected total fantasy points')).not.toBeInTheDocument();
    expect(screen.queryByText(/FPTS/)).not.toBeInTheDocument();
    expect(screen.getByText('Short-handed points')).toBeInTheDocument();
  });
  it('uses remaining-season language after the opener', () => {
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    render(<SeasonProjectionCard row={{...row,games_remaining:64.123}} scoring={scoring} goalie={false} points />);
    expect(screen.getByText('Rest of season')).toBeInTheDocument();
    expect(screen.getByText('64.1 projected games remaining')).toBeInTheDocument();
  });
  it('retains all enabled categories, zero forecasts and negative contributions', () => {
    const items = projectionContributions(row, scoring, false);
    expect(items).toHaveLength(9);
    expect(items.find(x => x.key === 'short_handed_points')?.points).toBe(0);
    expect(items.find(x => x.key === 'plus_minus')?.points).toBe(-2);
    expect(items.find(x => x.key === 'penalty_minutes')?.points).toBe(-1);
    expect(items.reduce((sum, x) => sum + (x.points ?? 0), 0)).toBe(projectedSummary([row], scoring, false).points);
  });
  it('shows missing or unsupported forecasts as N/A, not zero points', () => {
    const items = projectionContributions({}, { skater: { faceoff_wins: 1 } }, false);
    expect(items.find(x => x.key === 'faceoff_wins')).toMatchObject({ count: null, points: null });
  });
  it('reweights contributions and keeps raw stats unchanged', () => {
    expect(projectionContributions(row, { skater: { goals: 10 } }, false).find(x => x.key === 'goals')).toMatchObject({ count: 2, points: 20 });
    expect(row.projected_goals).toBe(2);
  });
  it('renders full labels without a cramped multi-column game table', () => {
    render(<ProjectionStatBreakdown row={row} scoring={scoring} goalie={false} />);
    expect(screen.getByText('Short-handed points')).toBeTruthy();
    expect(screen.getByText('Penalty minutes')).toBeTruthy();
    expect(screen.getByText('-2.00 FPTS')).toBeTruthy();
  });
  it('discloses a flat allocation and preserves distinct genuine daily forecasts', () => {
    const base: GameLogEntry = { date: '2026-10-01', dateLabel: 'Oct 1', dayLabel: 'Thu', opponent: 'vs BUF',
      projectedPoints: null, projection: { ...row, calculation_method: 'canonical_expected_volume_v1' }, isGoalie: false, isPast: false, isToday: false, computedConfidence: 0 };
    const entries = scoreGameLog([base, { ...base, date: '2026-10-03', projection: { ...row, projected_goals: 1, calculation_method: 'hybrid_bayesian' } }], scoring);
    expect(entries[0].projectedPoints! - entries[1].projectedPoints!).toBe(6);
    const { container } = render(<UpcomingProjectionCards entries={entries} scoring={scoring} ready points />);
    expect(screen.getByText(/Season-average allocation/)).toBeTruthy();
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(container.querySelector('details')?.open).toBe(true);
  });
  it('retains negative goalie scoring and a zero shutout contribution', () => {
    const items = projectionContributions({ projected_saves: 10, projected_goals_against: 5, projected_shutouts: 0 },
      { goalie: { saves: .1, goals_against: -2, shutouts: 5 } }, true);
    expect(items.find(x => x.key === 'goals_against')?.points).toBe(-10);
    expect(items.find(x => x.key === 'shutouts')?.points).toBe(0);
  });
  it('discloses calendar workload without suggesting a confirmed start or calibrated interval', () => {
    const entry:GameLogEntry={date:'2026-10-01',dateLabel:'Oct 1',dayLabel:'Thu',opponent:'vs BUF',
      projectedPoints:0,projection:{calculation_method:'canonical_goalie_calendar_v1',expected_starts:0,projected_saves:0},
      isGoalie:true,isPast:false,isToday:false,computedConfidence:0};
    render(<UpcomingProjectionCards entries={[entry]} scoring={{goalie:{saves:.6}}} ready points/>);
    expect(screen.getByText(/Calendar-adjusted expected workload, not a confirmed start/)).toBeInTheDocument();
    expect(screen.getByText('Expected starts: 0.00')).toBeInTheDocument();
    expect(screen.queryByText(/Season-average allocation/)).not.toBeInTheDocument();
  });
});
