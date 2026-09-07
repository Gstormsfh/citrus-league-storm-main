import { describe, expect, it, vi } from 'vitest';
import { calculateFparFoundation, type FparFoundationInput, type FparEvidenceVerifier } from './fparFoundation';
import { ScoringCalculator } from './scoring';

const now = '2026-09-06T10:00:00Z';
const verifyEvidence: FparEvidenceVerifier = async binding => ({ status: 'verified', binding: structuredClone(binding) });
function fixture(): FparFoundationInput {
  const scope = { leagueId: 'synthetic-league', teamId: 'synthetic-team', season: 2026, horizon: { start: '2026-10-01', end: '2026-10-07' }, asOf: now };
  const player = (playerId: number, points: number, positions: ('C' | 'LW')[], availability: 'owned' | 'available') => ({
    playerId, scope: structuredClone(scope), kind: 'skater' as const, eligiblePositions: positions, availability, status: 'active' as const,
    forecast: { status: 'verified' as const, stats: { goals: 0, assists: points, power_play_points: 0, short_handed_points: 0,
      shots_on_goal: 0, blocks: 0, hits: 0, penalty_minutes: 0, plus_minus: 0 },
    units: { goals: 'expected_count_over_horizon', assists: 'expected_count_over_horizon', power_play_points: 'expected_count_over_horizon',
      short_handed_points: 'expected_count_over_horizon', shots_on_goal: 'expected_count_over_horizon', blocks: 'expected_count_over_horizon',
      hits: 'expected_count_over_horizon', penalty_minutes: 'expected_penalty_minutes_over_horizon', plus_minus: 'expected_goal_differential_over_horizon' } },
  });
  return { contract: 'citrus-fpar-foundation-v1', scoringMode: 'points', scope,
    scoring: { skater: { goals: 0, assists: 1, power_play_points: 0, short_handed_points: 0, shots_on_goal: 0, blocks: 0, hits: 0, penalty_minutes: 0, plus_minus: 1 },
      goalie: { wins: 0, shutouts: 0, saves: 1, goals_against: -1 } },
    expectedPlayerIds: [1, 2, 3, 4], players: [player(1, 10, ['C', 'LW'], 'owned'), player(2, 9, ['C'], 'owned'),
      player(3, 8, ['C', 'LW'], 'available'), player(4, 7, ['C'], 'available')],
    slots: [{ slotId: 'c', eligiblePositions: ['C'] }, { slotId: 'lw', eligiblePositions: ['LW'] }],
    rosterPlayerIds: [1, 2], lineup: [{ slotId: 'c', playerId: 2 }, { slotId: 'lw', playerId: 1 }], move: null,
    evidence: { kind: 'synthetic', status: 'verified', foundationSha256: 'a'.repeat(64), forecastManifestSha256: 'b'.repeat(64), leagueSnapshotSha256: 'c'.repeat(64), eligibilityManifestSha256: 'd'.repeat(64) } };
}
const run = (input = fixture()) => calculateFparFoundation(input, { now, verifyEvidence });

describe('non-serving FPAR foundation', () => {
  it('uses the actual calculator and finds joint replacement rather than reusing a dual-eligible player', async () => {
    const spy = vi.spyOn(ScoringCalculator.prototype, 'calculatePoints');
    try {
      const input = fixture(), before = structuredClone(input), result = await run(input);
      expect(spy).toHaveBeenCalledTimes(4);
      expect(result.replacementAllocation.assignment.map(r => r.playerId)).toEqual([4, 3]);
      expect(result.replacementAllocation.total).toBe(15);
      expect(result.playerFpar.map(r => r.fpar)).toEqual([2, 2]);
      expect(result.additiveLineupFpar).toBe(4);
      expect(result.publishable).toBe(false); expect(result.evidenceKind).toBe('synthetic');
      expect(result.receiptSha256).toMatch(/^[a-f0-9]{64}$/); expect(input).toEqual(before);
    } finally { spy.mockRestore(); }
  });
  it('separates non-additive move opportunity from fixed-baseline player values', async () => {
    const input = fixture(); input.move = { dropPlayerId: 2, addPlayerId: 3 };
    const result = await run(input);
    expect(result.rosterMove?.before.total).toBe(19); expect(result.rosterMove?.after.total).toBe(18);
    expect(result.rosterMove?.opportunityValue).toBe(-1); expect(result.rosterMove?.additive).toBe(false);
    expect(result.additiveLineupFpar).toBe(4);
  });
  it('preserves genuine zero and negative fantasy points', async () => {
    const input = fixture();
    for (const p of input.players) { p.forecast.stats.assists = 0; p.forecast.stats.plus_minus = -p.playerId; }
    const result = await run(input);
    expect(result.replacementAllocation.total).toBe(-7); expect(result.additiveLineupFpar).toBe(4);
    for (const p of input.players) p.forecast.stats.plus_minus = 0;
    expect((await run(input)).additiveLineupFpar).toBe(0);
  });
  it('never mixes goalie/skater scoring or eligibility', async () => {
    const input = fixture();
    for (const p of input.players) {
      p.kind = 'goalie'; p.eligiblePositions = ['G']; p.forecast.stats = { wins: 0, shutouts: 0, saves: 10 - p.playerId, goals_against: 1 };
      p.forecast.units = Object.fromEntries(Object.keys(p.forecast.stats).map(k => [k, 'expected_count_over_horizon']));
    }
    input.slots = [{ slotId: 'c', eligiblePositions: ['G'] }, { slotId: 'lw', eligiblePositions: ['G'] }];
    const result = await run(input);
    expect(result.replacementAllocation.total).toBe(11); expect(result.additiveLineupFpar).toBe(4);
  });
  it.each(['missing', 'null', 'nan', 'infinity', 'negative', 'unit', 'alias'])('rejects unavailable physical inputs: %s', async bad => {
    const input = fixture(), forecast = input.players[0].forecast;
    if (bad === 'missing') delete forecast.stats.assists;
    else if (bad === 'unit') forecast.units.assists = 'per_game';
    else if (bad === 'alias') { forecast.stats.ppp = 0; }
    else forecast.stats.assists = ({ null: null, nan: NaN, infinity: Infinity, negative: -1 } as Record<string, number | null>)[bad];
    await expect(run(input)).rejects.toThrow('FPAR unavailable');
  });
  it.each(['league', 'horizon', 'asof', 'eligibility', 'duplicate', 'roster', 'slots', 'coverage', 'scoring', 'foundation'])('fails closed for scope or inventory errors: %s', async bad => {
    const input = fixture();
    if (bad === 'league') input.players[0].scope.leagueId = 'other';
    else if (bad === 'horizon') input.players[0].scope.horizon.end = '2026-10-08';
    else if (bad === 'asof') input.players[0].scope.asOf = '2026-09-05T10:00:00Z';
    else if (bad === 'eligibility') input.players[2].eligiblePositions = [];
    else if (bad === 'duplicate') input.players[1].playerId = 1;
    else if (bad === 'roster') input.lineup[1].playerId = 2;
    else if (bad === 'slots') input.slots[1].eligiblePositions = ['D'];
    else if (bad === 'coverage') input.players.pop();
    else if (bad === 'scoring') delete input.scoring.skater.plus_minus;
    else Object.assign(input.evidence, { status: 'unavailable' });
    await expect(run(input)).rejects.toThrow('FPAR unavailable');
  });
  it('rejects an infeasible free-agent matching even when each slot separately has a candidate', async () => {
    const input = fixture(); input.players[3].eligiblePositions = ['D'];
    await expect(run(input)).rejects.toThrow('infeasible');
  });
  it('does not use unavailable or IR players as replacement', async () => {
    const input = fixture(); input.players[2].status = 'ir';
    await expect(run(input)).rejects.toThrow('candidates');
  });
  it('rejects absent or detached verifier responses before scoring', async () => {
    const spy = vi.spyOn(ScoringCalculator.prototype, 'calculatePoints');
    try {
      await expect(calculateFparFoundation(fixture(), { now, verifyEvidence: (async () => true) as unknown as FparEvidenceVerifier })).rejects.toThrow();
      await expect(calculateFparFoundation(fixture(), { now, verifyEvidence: async binding => ({ status: 'verified', binding: { ...binding, scoringSha256: 'f'.repeat(64) } }) })).rejects.toThrow('detached');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('isolates caller mutation while awaiting evidence verification', async () => {
    const input = fixture();
    const result = await calculateFparFoundation(input, { now, verifyEvidence: async binding => {
      input.players[0].forecast.stats.assists = 999; input.scoring.skater.assists = 999;
      return { status: 'verified', binding };
    } });
    expect(result.additiveLineupFpar).toBe(4);
  });
  it('allocation is deterministic under candidate reordering', async () => {
    const input = fixture(), first = await run(input); input.players.reverse(); input.expectedPlayerIds.reverse();
    const second = await run(input);
    expect(second.replacementAllocation).toEqual(first.replacementAllocation);
    expect(second.playerFpar).toEqual(first.playerFpar);
  });
  it('rejects categories scoring, future as-of and malformed dates', async () => {
    const input = fixture(); Object.assign(input, { scoringMode: 'categories' }); await expect(run(input)).rejects.toThrow();
    const late = fixture(); late.scope.asOf = '2099-01-01T00:00:00Z'; await expect(run(late)).rejects.toThrow();
    const badDate = fixture(); badDate.scope.horizon.start = '2026-02-30'; await expect(run(badDate)).rejects.toThrow();
  });
  it('rejects goals outside the on-goal forecast population and preserves equal finite totals', async () => {
    const input = fixture(); input.players[0].forecast.stats.goals = 1;
    await expect(run(input)).rejects.toThrow('goals exceed');
    input.players[0].forecast.stats.shots_on_goal = 1;
    await expect(run(input)).resolves.toBeDefined();
  });
  it('matches exhaustive feasible two-slot allocations across eligibility patterns', async () => {
    const sets = [['C'], ['LW'], ['C', 'LW']] as const;
    for (const a of sets) for (const b of sets) for (const c of sets) {
      const input = fixture(); input.players[2].eligiblePositions = [...a]; input.players[3].eligiblePositions = [...b];
      const extra = structuredClone(input.players[2]); extra.playerId = 5; extra.eligiblePositions = [...c]; extra.forecast.stats.assists = 6;
      input.players.push(extra); input.expectedPlayerIds.push(5);
      const pool = input.players.slice(2); const totals: number[] = [];
      for (const left of pool) for (const right of pool) if (left !== right && left.eligiblePositions.includes('C') && right.eligiblePositions.includes('LW')) totals.push(left.forecast.stats.assists + right.forecast.stats.assists);
      if (!totals.length) await expect(run(input)).rejects.toThrow();
      else expect((await run(input)).replacementAllocation.total).toBe(Math.max(...totals));
    }
  });
});
