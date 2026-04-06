import { describe, it, expect } from 'vitest';
import {
  buildPlayoffBracket,
  validateBracketSize,
  snapToBracketSize,
  calculatePlayoffWeeksNeeded,
  calculatePlayoffStartWeek,
  getSeriesByRound,
  getWinnersSeries,
  getConsolationSeries,
  getChampionshipSeries,
  getThirdPlaceSeries,
  getFirstRoundMatchups,
  getRoundName,
  validateAdvancementWiring,
  type BracketSize,
  type BracketStructure,
} from '@citrus/shared';

// =============================================================================
// validateBracketSize
// =============================================================================

describe('validateBracketSize', () => {
  it('returns 8 for 8+ teams', () => {
    expect(validateBracketSize(8)).toBe(8);
    expect(validateBracketSize(10)).toBe(8);
    expect(validateBracketSize(12)).toBe(8);
  });

  it('returns 6 for 6-7 teams', () => {
    expect(validateBracketSize(6)).toBe(6);
    expect(validateBracketSize(7)).toBe(6);
  });

  it('returns 4 for 4-5 teams', () => {
    expect(validateBracketSize(4)).toBe(4);
    expect(validateBracketSize(5)).toBe(4);
  });

  it('returns null for fewer than 4 teams', () => {
    expect(validateBracketSize(3)).toBeNull();
    expect(validateBracketSize(1)).toBeNull();
    expect(validateBracketSize(0)).toBeNull();
  });
});

// =============================================================================
// snapToBracketSize
// =============================================================================

describe('snapToBracketSize', () => {
  it('returns exact bracket sizes for valid values', () => {
    expect(snapToBracketSize(4)).toBe(4);
    expect(snapToBracketSize(6)).toBe(6);
    expect(snapToBracketSize(8)).toBe(8);
  });

  it('snaps non-standard numbers to nearest valid bracket', () => {
    expect(snapToBracketSize(5)).toBe(4);
    expect(snapToBracketSize(7)).toBe(6);
    expect(snapToBracketSize(9)).toBe(8);
  });

  it('returns null for too-small values', () => {
    expect(snapToBracketSize(3)).toBeNull();
    expect(snapToBracketSize(0)).toBeNull();
  });
});

// =============================================================================
// calculatePlayoffWeeksNeeded
// =============================================================================

describe('calculatePlayoffWeeksNeeded', () => {
  it('4-team bracket needs 2 weeks (1-week matchups)', () => {
    expect(calculatePlayoffWeeksNeeded(4, false)).toBe(2);
  });

  it('4-team bracket needs 4 weeks (2-week matchups)', () => {
    expect(calculatePlayoffWeeksNeeded(4, true)).toBe(4);
  });

  it('6-team bracket needs 3 weeks (1-week matchups)', () => {
    expect(calculatePlayoffWeeksNeeded(6, false)).toBe(3);
  });

  it('6-team bracket needs 6 weeks (2-week matchups)', () => {
    expect(calculatePlayoffWeeksNeeded(6, true)).toBe(6);
  });

  it('8-team bracket needs 3 weeks (1-week matchups)', () => {
    expect(calculatePlayoffWeeksNeeded(8, false)).toBe(3);
  });

  it('8-team bracket needs 6 weeks (2-week matchups)', () => {
    expect(calculatePlayoffWeeksNeeded(8, true)).toBe(6);
  });
});

// =============================================================================
// calculatePlayoffStartWeek
// =============================================================================

describe('calculatePlayoffStartWeek', () => {
  it('uses explicit regularSeasonWeeks when provided', () => {
    const result = calculatePlayoffStartWeek({
      regularSeasonWeeks: 20,
      totalAvailableWeeks: 25,
      bracketSize: 6,
      twoWeekMatchups: false,
    });
    expect(result.playoffStartWeek).toBe(21);
    expect(result.regularSeasonWeeks).toBe(20);
    expect(result.playoffWeeksNeeded).toBe(3);
    expect(result.fits).toBe(true); // 21+3-1=23 <= 25
  });

  it('auto-calculates regular season when not provided', () => {
    const result = calculatePlayoffStartWeek({
      totalAvailableWeeks: 25,
      bracketSize: 6,
      twoWeekMatchups: false,
    });
    // 25 total - 3 playoff = 22 regular season
    expect(result.regularSeasonWeeks).toBe(22);
    expect(result.playoffStartWeek).toBe(23);
    expect(result.fits).toBe(true);
  });

  it('detects when playoffs do not fit in available weeks', () => {
    const result = calculatePlayoffStartWeek({
      regularSeasonWeeks: 24,
      totalAvailableWeeks: 25,
      bracketSize: 8,
      twoWeekMatchups: false,
    });
    // Starts week 25, needs 3 weeks (25, 26, 27) but only 25 available
    expect(result.fits).toBe(false);
    expect(result.playoffWeeksNeeded).toBe(3);
  });

  it('fits exactly when math works out', () => {
    const result = calculatePlayoffStartWeek({
      regularSeasonWeeks: 22,
      totalAvailableWeeks: 25,
      bracketSize: 8,
      twoWeekMatchups: false,
    });
    // Start week 23, needs 23+24+25 = fits in 25
    expect(result.fits).toBe(true);
    expect(result.playoffStartWeek).toBe(23);
  });

  it('handles two-week matchups fitting calculation', () => {
    const result = calculatePlayoffStartWeek({
      regularSeasonWeeks: 18,
      totalAvailableWeeks: 24,
      bracketSize: 6,
      twoWeekMatchups: true,
    });
    // Needs 6 weeks for 2-week matchups, start week 19, last week 24
    expect(result.playoffWeeksNeeded).toBe(6);
    expect(result.fits).toBe(true);
  });
});

// =============================================================================
// buildPlayoffBracket — 4-team
// =============================================================================

describe('buildPlayoffBracket (4-team)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 4,
    playoffStartWeek: 23,
  });

  it('has correct metadata', () => {
    expect(bracket.bracketSize).toBe(4);
    expect(bracket.totalRounds).toBe(2);
    expect(bracket.playoffStartWeek).toBe(23);
    expect(bracket.totalWeeksNeeded).toBe(2);
    expect(bracket.twoWeekMatchups).toBe(false);
    expect(bracket.consolationEnabled).toBe(false);
    expect(bracket.byeSeeds).toEqual([]);
  });

  it('has 3 series (2 semis + 1 final)', () => {
    expect(bracket.series).toHaveLength(3);
  });

  it('has correct round names', () => {
    expect(bracket.roundNames[1]).toBe('Semifinals');
    expect(bracket.roundNames[2]).toBe('Championship');
  });

  it('seeds #1 vs #4 and #2 vs #3 in round 1', () => {
    const r1 = getSeriesByRound(bracket, 1);
    expect(r1).toHaveLength(2);
    expect(r1[0].homeSeed).toBe(1);
    expect(r1[0].awaySeed).toBe(4);
    expect(r1[1].homeSeed).toBe(2);
    expect(r1[1].awaySeed).toBe(3);
  });

  it('round 1 series are active, round 2 is pending', () => {
    const r1 = getSeriesByRound(bracket, 1);
    expect(r1.every(s => s.status === 'active')).toBe(true);
    const championship = getChampionshipSeries(bracket);
    expect(championship!.status).toBe('pending');
  });

  it('assigns correct weeks', () => {
    const r1 = getSeriesByRound(bracket, 1);
    expect(r1[0].matchupWeek1).toBe(23);
    expect(r1[0].matchupWeek2).toBeNull();
    const championship = getChampionshipSeries(bracket);
    expect(championship!.matchupWeek1).toBe(24);
    expect(championship!.matchupWeek2).toBeNull();
  });

  it('wires SF winners to Finals', () => {
    const r1 = getSeriesByRound(bracket, 1);
    const finals = getChampionshipSeries(bracket)!;
    expect(r1[0].winnerAdvancesTo).toBe(finals.key);
    expect(r1[0].winnerSlot).toBe('home');
    expect(r1[1].winnerAdvancesTo).toBe(finals.key);
    expect(r1[1].winnerSlot).toBe('away');
  });

  it('has no consolation wiring without consolation enabled', () => {
    const r1 = getSeriesByRound(bracket, 1);
    expect(r1[0].loserDropsTo).toBeNull();
    expect(r1[1].loserDropsTo).toBeNull();
  });

  it('passes advancement wiring validation', () => {
    const result = validateAdvancementWiring(bracket);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('buildPlayoffBracket (4-team, consolation)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 4,
    playoffStartWeek: 23,
    consolationEnabled: true,
  });

  it('has 4 series (2 semis + 1 final + 1 third place)', () => {
    expect(bracket.series).toHaveLength(4);
  });

  it('creates third-place game', () => {
    const thirdPlace = getThirdPlaceSeries(bracket);
    expect(thirdPlace).toBeDefined();
    expect(thirdPlace!.bracketPosition).toBe('third_place');
    expect(thirdPlace!.roundNumber).toBe(2);
  });

  it('wires SF losers to third-place game', () => {
    const r1 = getSeriesByRound(bracket, 1);
    const thirdPlace = getThirdPlaceSeries(bracket)!;
    expect(r1[0].loserDropsTo).toBe(thirdPlace.key);
    expect(r1[0].loserSlot).toBe('home');
    expect(r1[1].loserDropsTo).toBe(thirdPlace.key);
    expect(r1[1].loserSlot).toBe('away');
  });
});

describe('buildPlayoffBracket (4-team, two-week matchups)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 4,
    playoffStartWeek: 21,
    twoWeekMatchups: true,
  });

  it('needs 4 weeks total', () => {
    expect(bracket.totalWeeksNeeded).toBe(4);
  });

  it('assigns 2 weeks per round', () => {
    const r1 = getSeriesByRound(bracket, 1);
    expect(r1[0].matchupWeek1).toBe(21);
    expect(r1[0].matchupWeek2).toBe(22);
    const finals = getChampionshipSeries(bracket)!;
    expect(finals.matchupWeek1).toBe(23);
    expect(finals.matchupWeek2).toBe(24);
  });
});

// =============================================================================
// buildPlayoffBracket — 6-team
// =============================================================================

describe('buildPlayoffBracket (6-team)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 6,
    playoffStartWeek: 22,
  });

  it('has correct metadata', () => {
    expect(bracket.bracketSize).toBe(6);
    expect(bracket.totalRounds).toBe(3);
    expect(bracket.totalWeeksNeeded).toBe(3);
    expect(bracket.byeSeeds).toEqual([1, 2]);
  });

  it('has 5 winners series (2 WC + 2 SF + 1 Finals)', () => {
    const winners = getWinnersSeries(bracket);
    expect(winners).toHaveLength(5);
  });

  it('round 1 is Wild Card: #3 vs #6, #4 vs #5', () => {
    const r1 = getFirstRoundMatchups(bracket);
    expect(r1).toHaveLength(2);
    expect(r1[0].homeSeed).toBe(3);
    expect(r1[0].awaySeed).toBe(6);
    expect(r1[1].homeSeed).toBe(4);
    expect(r1[1].awaySeed).toBe(5);
  });

  it('round 2 has bye seeds pre-populated (home) with away TBD', () => {
    const r2 = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    expect(r2).toHaveLength(2);
    // SF1: #1 seed (bye) vs WC winner
    expect(r2[0].homeSeed).toBe(1);
    expect(r2[0].awaySeed).toBeNull();
    // SF2: #2 seed (bye) vs WC winner
    expect(r2[1].homeSeed).toBe(2);
    expect(r2[1].awaySeed).toBeNull();
  });

  it('WC winners advance to correct SF slots', () => {
    const r1 = getFirstRoundMatchups(bracket);
    const r2Winners = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    // WC1 (#3v#6) winner -> SF2 (faces #2 seed)
    expect(r1[0].winnerAdvancesTo).toBe(r2Winners[1].key);
    expect(r1[0].winnerSlot).toBe('away');
    // WC2 (#4v#5) winner -> SF1 (faces #1 seed)
    expect(r1[1].winnerAdvancesTo).toBe(r2Winners[0].key);
    expect(r1[1].winnerSlot).toBe('away');
  });

  it('assigns correct weeks: WC=22, SF=23, Finals=24', () => {
    const r1 = getFirstRoundMatchups(bracket);
    expect(r1[0].matchupWeek1).toBe(22);
    const r2 = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    expect(r2[0].matchupWeek1).toBe(23);
    const finals = getChampionshipSeries(bracket)!;
    expect(finals.matchupWeek1).toBe(24);
  });

  it('has correct round names', () => {
    expect(bracket.roundNames[1]).toBe('Wild Card Round');
    expect(bracket.roundNames[2]).toBe('Semifinals');
    expect(bracket.roundNames[3]).toBe('Championship');
  });

  it('passes advancement wiring validation', () => {
    const result = validateAdvancementWiring(bracket);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('buildPlayoffBracket (6-team, consolation)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 6,
    playoffStartWeek: 22,
    consolationEnabled: true,
  });

  it('has third-place game', () => {
    const tp = getThirdPlaceSeries(bracket);
    expect(tp).toBeDefined();
    expect(tp!.matchupWeek1).toBe(24); // Same week as finals
  });

  it('wires SF losers to third-place', () => {
    const sf = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    const tp = getThirdPlaceSeries(bracket)!;
    expect(sf[0].loserDropsTo).toBe(tp.key);
    expect(sf[1].loserDropsTo).toBe(tp.key);
  });
});

describe('buildPlayoffBracket (6-team, two-week matchups)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 6,
    playoffStartWeek: 19,
    twoWeekMatchups: true,
  });

  it('needs 6 weeks total', () => {
    expect(bracket.totalWeeksNeeded).toBe(6);
  });

  it('assigns correct two-week spans', () => {
    const r1 = getFirstRoundMatchups(bracket);
    expect(r1[0].matchupWeek1).toBe(19);
    expect(r1[0].matchupWeek2).toBe(20);
    const r2 = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    expect(r2[0].matchupWeek1).toBe(21);
    expect(r2[0].matchupWeek2).toBe(22);
    const finals = getChampionshipSeries(bracket)!;
    expect(finals.matchupWeek1).toBe(23);
    expect(finals.matchupWeek2).toBe(24);
  });
});

// =============================================================================
// buildPlayoffBracket — 8-team
// =============================================================================

describe('buildPlayoffBracket (8-team)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 8,
    playoffStartWeek: 22,
  });

  it('has correct metadata', () => {
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.totalRounds).toBe(3);
    expect(bracket.totalWeeksNeeded).toBe(3);
    expect(bracket.byeSeeds).toEqual([]);
  });

  it('has 7 winners series (4 QF + 2 SF + 1 Finals)', () => {
    const winners = getWinnersSeries(bracket);
    expect(winners).toHaveLength(7);
  });

  it('round 1 has standard seeding: 1v8, 4v5, 2v7, 3v6', () => {
    const r1 = getFirstRoundMatchups(bracket);
    expect(r1).toHaveLength(4);
    expect(r1[0].homeSeed).toBe(1);
    expect(r1[0].awaySeed).toBe(8);
    expect(r1[1].homeSeed).toBe(4);
    expect(r1[1].awaySeed).toBe(5);
    expect(r1[2].homeSeed).toBe(2);
    expect(r1[2].awaySeed).toBe(7);
    expect(r1[3].homeSeed).toBe(3);
    expect(r1[3].awaySeed).toBe(6);
  });

  it('QF winners advance to correct SF slots', () => {
    const qf = getFirstRoundMatchups(bracket);
    const sf = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    // QF1 (1v8) winner -> SF1 home
    expect(qf[0].winnerAdvancesTo).toBe(sf[0].key);
    expect(qf[0].winnerSlot).toBe('home');
    // QF2 (4v5) winner -> SF1 away
    expect(qf[1].winnerAdvancesTo).toBe(sf[0].key);
    expect(qf[1].winnerSlot).toBe('away');
    // QF3 (2v7) winner -> SF2 home
    expect(qf[2].winnerAdvancesTo).toBe(sf[1].key);
    expect(qf[2].winnerSlot).toBe('home');
    // QF4 (3v6) winner -> SF2 away
    expect(qf[3].winnerAdvancesTo).toBe(sf[1].key);
    expect(qf[3].winnerSlot).toBe('away');
  });

  it('SF winners advance to Finals', () => {
    const sf = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    const finals = getChampionshipSeries(bracket)!;
    expect(sf[0].winnerAdvancesTo).toBe(finals.key);
    expect(sf[0].winnerSlot).toBe('home');
    expect(sf[1].winnerAdvancesTo).toBe(finals.key);
    expect(sf[1].winnerSlot).toBe('away');
  });

  it('assigns correct weeks: QF=22, SF=23, Finals=24', () => {
    const qf = getFirstRoundMatchups(bracket);
    expect(qf[0].matchupWeek1).toBe(22);
    const sf = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    expect(sf[0].matchupWeek1).toBe(23);
    const finals = getChampionshipSeries(bracket)!;
    expect(finals.matchupWeek1).toBe(24);
  });

  it('has correct round names', () => {
    expect(bracket.roundNames[1]).toBe('Quarterfinals');
    expect(bracket.roundNames[2]).toBe('Semifinals');
    expect(bracket.roundNames[3]).toBe('Championship');
  });

  it('passes advancement wiring validation', () => {
    const result = validateAdvancementWiring(bracket);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('buildPlayoffBracket (8-team, full consolation)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 8,
    playoffStartWeek: 22,
    consolationEnabled: true,
  });

  it('has winners + consolation + third-place series', () => {
    const winners = getWinnersSeries(bracket);
    const consolation = getConsolationSeries(bracket);
    const tp = getThirdPlaceSeries(bracket);
    expect(winners).toHaveLength(7);     // 4 QF + 2 SF + 1 Finals
    expect(consolation).toHaveLength(3); // 2 Con R1 + 1 Con Finals
    expect(tp).toBeDefined();
    // Total: 7 + 3 + 1 = 11
    expect(bracket.series).toHaveLength(11);
  });

  it('QF losers drop to consolation bracket', () => {
    const qf = getFirstRoundMatchups(bracket);
    const con = getConsolationSeries(bracket);
    const conR1 = con.filter(s => s.roundNumber === 2);
    expect(conR1).toHaveLength(2);
    // QF1 loser -> Con1 home, QF2 loser -> Con1 away
    expect(qf[0].loserDropsTo).toBe(conR1[0].key);
    expect(qf[0].loserSlot).toBe('home');
    expect(qf[1].loserDropsTo).toBe(conR1[0].key);
    expect(qf[1].loserSlot).toBe('away');
    // QF3 loser -> Con2 home, QF4 loser -> Con2 away
    expect(qf[2].loserDropsTo).toBe(conR1[1].key);
    expect(qf[2].loserSlot).toBe('home');
    expect(qf[3].loserDropsTo).toBe(conR1[1].key);
    expect(qf[3].loserSlot).toBe('away');
  });

  it('consolation R1 winners advance to consolation finals', () => {
    const con = getConsolationSeries(bracket);
    const conR1 = con.filter(s => s.roundNumber === 2);
    const conFinals = con.find(s => s.roundNumber === 3);
    expect(conR1[0].winnerAdvancesTo).toBe(conFinals!.key);
    expect(conR1[0].winnerSlot).toBe('home');
    expect(conR1[1].winnerAdvancesTo).toBe(conFinals!.key);
    expect(conR1[1].winnerSlot).toBe('away');
  });

  it('SF losers go to third-place game', () => {
    const sf = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    const tp = getThirdPlaceSeries(bracket)!;
    expect(sf[0].loserDropsTo).toBe(tp.key);
    expect(sf[0].loserSlot).toBe('home');
    expect(sf[1].loserDropsTo).toBe(tp.key);
    expect(sf[1].loserSlot).toBe('away');
  });

  it('consolation series run on correct weeks', () => {
    const con = getConsolationSeries(bracket);
    const conR1 = con.filter(s => s.roundNumber === 2);
    const conFinals = con.find(s => s.roundNumber === 3)!;
    // Consolation R1 runs same week as SF (week 23)
    expect(conR1[0].matchupWeek1).toBe(23);
    expect(conR1[1].matchupWeek1).toBe(23);
    // Consolation Finals runs same week as Championship (week 24)
    expect(conFinals.matchupWeek1).toBe(24);
  });
});

describe('buildPlayoffBracket (8-team, two-week matchups)', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 8,
    playoffStartWeek: 15,
    twoWeekMatchups: true,
  });

  it('needs 6 weeks total', () => {
    expect(bracket.totalWeeksNeeded).toBe(6);
  });

  it('assigns correct two-week spans', () => {
    const qf = getFirstRoundMatchups(bracket);
    expect(qf[0].matchupWeek1).toBe(15);
    expect(qf[0].matchupWeek2).toBe(16);
    const sf = getSeriesByRound(bracket, 2).filter(s => s.bracketPosition === 'winners');
    expect(sf[0].matchupWeek1).toBe(17);
    expect(sf[0].matchupWeek2).toBe(18);
    const finals = getChampionshipSeries(bracket)!;
    expect(finals.matchupWeek1).toBe(19);
    expect(finals.matchupWeek2).toBe(20);
  });
});

// =============================================================================
// Edge cases & error handling
// =============================================================================

describe('buildPlayoffBracket edge cases', () => {
  it('throws for invalid bracket size', () => {
    expect(() => buildPlayoffBracket({
      bracketSize: 5 as BracketSize,
      playoffStartWeek: 22,
    })).toThrow('Invalid bracket size: 5');
  });

  it('throws for bracket size 10', () => {
    expect(() => buildPlayoffBracket({
      bracketSize: 10 as BracketSize,
      playoffStartWeek: 22,
    })).toThrow('Invalid bracket size: 10');
  });

  it('works with playoffStartWeek = 1 (entire season is playoffs)', () => {
    const bracket = buildPlayoffBracket({
      bracketSize: 4,
      playoffStartWeek: 1,
    });
    expect(bracket.series[0].matchupWeek1).toBe(1);
    const finals = getChampionshipSeries(bracket)!;
    expect(finals.matchupWeek1).toBe(2);
  });

  it('defaults twoWeekMatchups to false', () => {
    const bracket = buildPlayoffBracket({
      bracketSize: 4,
      playoffStartWeek: 22,
    });
    expect(bracket.twoWeekMatchups).toBe(false);
    expect(bracket.series[0].matchupWeek2).toBeNull();
  });

  it('defaults consolationEnabled to false', () => {
    const bracket = buildPlayoffBracket({
      bracketSize: 8,
      playoffStartWeek: 22,
    });
    expect(bracket.consolationEnabled).toBe(false);
    expect(getConsolationSeries(bracket)).toHaveLength(0);
    expect(getThirdPlaceSeries(bracket)).toBeUndefined();
  });
});

// =============================================================================
// getRoundName
// =============================================================================

describe('getRoundName', () => {
  it('returns correct names for 4-team bracket', () => {
    expect(getRoundName(4, 1)).toBe('Semifinals');
    expect(getRoundName(4, 2)).toBe('Championship');
  });

  it('returns correct names for 6-team bracket', () => {
    expect(getRoundName(6, 1)).toBe('Wild Card Round');
    expect(getRoundName(6, 2)).toBe('Semifinals');
    expect(getRoundName(6, 3)).toBe('Championship');
  });

  it('returns correct names for 8-team bracket', () => {
    expect(getRoundName(8, 1)).toBe('Quarterfinals');
    expect(getRoundName(8, 2)).toBe('Semifinals');
    expect(getRoundName(8, 3)).toBe('Championship');
  });

  it('falls back for unknown rounds', () => {
    expect(getRoundName(4, 5)).toBe('Round 5');
    expect(getRoundName(8, 99)).toBe('Round 99');
  });
});

// =============================================================================
// Query helpers
// =============================================================================

describe('query helpers', () => {
  const bracket = buildPlayoffBracket({
    bracketSize: 8,
    playoffStartWeek: 22,
    consolationEnabled: true,
  });

  it('getSeriesByRound returns correct count per round', () => {
    // Round 1: 4 QF
    expect(getSeriesByRound(bracket, 1)).toHaveLength(4);
    // Round 2: 2 SF + 2 consolation = 4
    expect(getSeriesByRound(bracket, 2)).toHaveLength(4);
    // Round 3: 1 Finals + 1 Third Place + 1 Con Finals = 3
    expect(getSeriesByRound(bracket, 3)).toHaveLength(3);
  });

  it('getWinnersSeries excludes consolation and third place', () => {
    const winners = getWinnersSeries(bracket);
    expect(winners.every(s => s.bracketPosition === 'winners')).toBe(true);
  });

  it('getConsolationSeries only returns consolation', () => {
    const con = getConsolationSeries(bracket);
    expect(con.every(s => s.bracketPosition === 'consolation')).toBe(true);
  });

  it('getFirstRoundMatchups only returns active round-1 series', () => {
    const first = getFirstRoundMatchups(bracket);
    expect(first.every(s => s.roundNumber === 1 && s.status === 'active')).toBe(true);
  });
});

// =============================================================================
// Comprehensive wiring validation across all sizes
// =============================================================================

describe('advancement wiring integrity', () => {
  const sizes: BracketSize[] = [4, 6, 8];
  const configs = [
    { consolationEnabled: false, twoWeekMatchups: false },
    { consolationEnabled: true, twoWeekMatchups: false },
    { consolationEnabled: false, twoWeekMatchups: true },
    { consolationEnabled: true, twoWeekMatchups: true },
  ];

  for (const size of sizes) {
    for (const config of configs) {
      const label = `${size}-team, consolation=${config.consolationEnabled}, twoWeek=${config.twoWeekMatchups}`;
      it(`passes validation for ${label}`, () => {
        const bracket = buildPlayoffBracket({
          bracketSize: size,
          playoffStartWeek: 20,
          ...config,
        });
        const result = validateAdvancementWiring(bracket);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    }
  }
});

// =============================================================================
// Series key uniqueness
// =============================================================================

describe('series key uniqueness', () => {
  const sizes: BracketSize[] = [4, 6, 8];

  for (const size of sizes) {
    it(`all keys are unique for ${size}-team bracket with consolation`, () => {
      const bracket = buildPlayoffBracket({
        bracketSize: size,
        playoffStartWeek: 20,
        consolationEnabled: true,
      });
      const keys = bracket.series.map(s => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});

// =============================================================================
// Week assignment consistency
// =============================================================================

describe('week assignment consistency', () => {
  it('later rounds always have higher week numbers', () => {
    const bracket = buildPlayoffBracket({
      bracketSize: 8,
      playoffStartWeek: 20,
      consolationEnabled: true,
    });

    const winnersByRound = new Map<number, number[]>();
    for (const s of getWinnersSeries(bracket)) {
      if (!winnersByRound.has(s.roundNumber)) winnersByRound.set(s.roundNumber, []);
      winnersByRound.get(s.roundNumber)!.push(s.matchupWeek1);
    }

    const rounds = Array.from(winnersByRound.keys()).sort();
    for (let i = 1; i < rounds.length; i++) {
      const prevMax = Math.max(...winnersByRound.get(rounds[i - 1])!);
      const currMin = Math.min(...winnersByRound.get(rounds[i])!);
      expect(currMin).toBeGreaterThan(prevMax);
    }
  });

  it('all series in the same round share the same week', () => {
    const bracket = buildPlayoffBracket({
      bracketSize: 8,
      playoffStartWeek: 20,
    });

    for (let round = 1; round <= bracket.totalRounds; round++) {
      const roundSeries = getSeriesByRound(bracket, round);
      const weeks = new Set(roundSeries.map(s => s.matchupWeek1));
      expect(weeks.size).toBe(1);
    }
  });
});
