import { describe, it, expect } from 'vitest';
import {
  COLUMNS,
  MATCHUP_COLUMNS,
  MATCHUP_COLUMNS_SLIM,
  LEAGUE_COLUMNS,
  LEAGUE_COLUMNS_SLIM,
  TEAM_COLUMNS,
  TEAM_COLUMNS_SLIM,
  ROSTER_ASSIGNMENT_COLUMNS,
  ROSTER_ASSIGNMENT_COLUMNS_SLIM,
  DRAFT_PICK_COLUMNS,
  DRAFT_PICK_COLUMNS_SLIM,
  NHL_GAME_COLUMNS,
  NHL_GAME_COLUMNS_SLIM,
  NHL_GAME_COLUMNS_MINIMAL,
  MATCHUP_LINES_COLUMNS,
  MATCHUP_LINES_COLUMNS_SLIM,
  COUNT_ONLY,
} from '../queryColumns';

/** Parse a column string into a set of trimmed column names */
function parseColumns(columnStr: string): Set<string> {
  return new Set(columnStr.split(',').map((c) => c.trim()));
}

// =============================================================================
// COLUMNS object — expected keys
// =============================================================================

describe('COLUMNS object exports', () => {
  const expectedFullKeys = [
    'MATCHUP', 'LEAGUE', 'TEAM', 'ROSTER_ASSIGNMENT', 'DRAFT_PICK',
    'DRAFT_ORDER', 'NHL_GAME', 'PLAYER_STATS', 'WAIVER', 'TRADE',
    'MATCHUP_LINES', 'PROFILE', 'PLAYER_PROJECTED_STATS',
    'KEEPER_DESIGNATION', 'AUCTION_BUDGET', 'AUCTION_NOMINATION',
    'AUCTION_BID', 'DRAFT_SNAPSHOT', 'POOL_PICK', 'CONFIDENCE_PICK',
    'GAME_SPREAD', 'PLAYOFF_BRACKET', 'PLAYOFF_SEED', 'PLAYOFF_SERIES',
  ];

  const expectedSlimKeys = [
    'MATCHUP_SLIM', 'MATCHUP_LINES_SLIM', 'LEAGUE_SLIM', 'TEAM_SLIM',
    'ROSTER_ASSIGNMENT_SLIM', 'DRAFT_PICK_SLIM', 'NHL_GAME_SLIM',
    'NHL_GAME_MINIMAL',
  ];

  it.each(expectedFullKeys)('has the full column key "%s"', (key) => {
    expect(COLUMNS).toHaveProperty(key);
  });

  it.each(expectedSlimKeys)('has the slim column key "%s"', (key) => {
    expect(COLUMNS).toHaveProperty(key);
  });

  it('has the COUNT key', () => {
    expect(COLUMNS).toHaveProperty('COUNT');
  });

  it('COLUMNS.COUNT equals "id"', () => {
    expect(COLUMNS.COUNT).toBe('id');
  });

  it('COUNT_ONLY equals "id"', () => {
    expect(COUNT_ONLY).toBe('id');
  });
});

// =============================================================================
// No column string contains '*' (enforcing no SELECT *)
// =============================================================================

describe('No SELECT * in column strings', () => {
  it('no COLUMNS value contains "*"', () => {
    for (const [key, value] of Object.entries(COLUMNS)) {
      expect(value, `COLUMNS.${key} should not contain *`).not.toContain('*');
    }
  });

  it('individual exports do not contain "*"', () => {
    const allExports = [
      MATCHUP_COLUMNS, MATCHUP_COLUMNS_SLIM,
      LEAGUE_COLUMNS, LEAGUE_COLUMNS_SLIM,
      TEAM_COLUMNS, TEAM_COLUMNS_SLIM,
      ROSTER_ASSIGNMENT_COLUMNS, ROSTER_ASSIGNMENT_COLUMNS_SLIM,
      DRAFT_PICK_COLUMNS, DRAFT_PICK_COLUMNS_SLIM,
      NHL_GAME_COLUMNS, NHL_GAME_COLUMNS_SLIM, NHL_GAME_COLUMNS_MINIMAL,
      MATCHUP_LINES_COLUMNS, MATCHUP_LINES_COLUMNS_SLIM,
      COUNT_ONLY,
    ];
    for (const col of allExports) {
      expect(col).not.toContain('*');
    }
  });
});

// =============================================================================
// All COLUMNS values are non-empty strings
// =============================================================================

describe('All column values are valid strings', () => {
  it('every COLUMNS value is a non-empty string', () => {
    for (const [key, value] of Object.entries(COLUMNS)) {
      expect(typeof value, `COLUMNS.${key} should be a string`).toBe('string');
      expect((value as string).length, `COLUMNS.${key} should not be empty`).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Slim versions are subsets of full versions
// =============================================================================

describe('Slim columns are subsets of full columns', () => {
  it('MATCHUP_SLIM is a subset of MATCHUP', () => {
    const full = parseColumns(MATCHUP_COLUMNS);
    const slim = parseColumns(MATCHUP_COLUMNS_SLIM);
    for (const col of slim) {
      expect(full.has(col), `"${col}" from MATCHUP_SLIM should exist in MATCHUP`).toBe(true);
    }
  });

  it('LEAGUE_SLIM is a subset of LEAGUE', () => {
    const full = parseColumns(LEAGUE_COLUMNS);
    const slim = parseColumns(LEAGUE_COLUMNS_SLIM);
    for (const col of slim) {
      expect(full.has(col), `"${col}" from LEAGUE_SLIM should exist in LEAGUE`).toBe(true);
    }
  });

  it('TEAM_SLIM is a subset of TEAM', () => {
    const full = parseColumns(TEAM_COLUMNS);
    const slim = parseColumns(TEAM_COLUMNS_SLIM);
    for (const col of slim) {
      expect(full.has(col), `"${col}" from TEAM_SLIM should exist in TEAM`).toBe(true);
    }
  });

  it('ROSTER_ASSIGNMENT_SLIM is a subset of ROSTER_ASSIGNMENT', () => {
    const full = parseColumns(ROSTER_ASSIGNMENT_COLUMNS);
    const slim = parseColumns(ROSTER_ASSIGNMENT_COLUMNS_SLIM);
    for (const col of slim) {
      expect(full.has(col), `"${col}" from ROSTER_ASSIGNMENT_SLIM should exist in ROSTER_ASSIGNMENT`).toBe(true);
    }
  });

  it('DRAFT_PICK_SLIM is a subset of DRAFT_PICK', () => {
    const full = parseColumns(DRAFT_PICK_COLUMNS);
    const slim = parseColumns(DRAFT_PICK_COLUMNS_SLIM);
    for (const col of slim) {
      expect(full.has(col), `"${col}" from DRAFT_PICK_SLIM should exist in DRAFT_PICK`).toBe(true);
    }
  });

  it('NHL_GAME_SLIM is a subset of NHL_GAME', () => {
    const full = parseColumns(NHL_GAME_COLUMNS);
    const slim = parseColumns(NHL_GAME_COLUMNS_SLIM);
    for (const col of slim) {
      expect(full.has(col), `"${col}" from NHL_GAME_SLIM should exist in NHL_GAME`).toBe(true);
    }
  });

  it('NHL_GAME_MINIMAL is a subset of NHL_GAME', () => {
    const full = parseColumns(NHL_GAME_COLUMNS);
    const minimal = parseColumns(NHL_GAME_COLUMNS_MINIMAL);
    for (const col of minimal) {
      expect(full.has(col), `"${col}" from NHL_GAME_MINIMAL should exist in NHL_GAME`).toBe(true);
    }
  });

  it('MATCHUP_LINES_SLIM is a subset of MATCHUP_LINES', () => {
    const full = parseColumns(MATCHUP_LINES_COLUMNS);
    const slim = parseColumns(MATCHUP_LINES_COLUMNS_SLIM);
    for (const col of slim) {
      expect(full.has(col), `"${col}" from MATCHUP_LINES_SLIM should exist in MATCHUP_LINES`).toBe(true);
    }
  });

  it('slim versions have fewer columns than full versions', () => {
    expect(parseColumns(MATCHUP_COLUMNS_SLIM).size).toBeLessThan(parseColumns(MATCHUP_COLUMNS).size);
    expect(parseColumns(LEAGUE_COLUMNS_SLIM).size).toBeLessThan(parseColumns(LEAGUE_COLUMNS).size);
    expect(parseColumns(TEAM_COLUMNS_SLIM).size).toBeLessThan(parseColumns(TEAM_COLUMNS).size);
    expect(parseColumns(ROSTER_ASSIGNMENT_COLUMNS_SLIM).size).toBeLessThan(parseColumns(ROSTER_ASSIGNMENT_COLUMNS).size);
    expect(parseColumns(DRAFT_PICK_COLUMNS_SLIM).size).toBeLessThan(parseColumns(DRAFT_PICK_COLUMNS).size);
    expect(parseColumns(NHL_GAME_COLUMNS_SLIM).size).toBeLessThan(parseColumns(NHL_GAME_COLUMNS).size);
    expect(parseColumns(MATCHUP_LINES_COLUMNS_SLIM).size).toBeLessThan(parseColumns(MATCHUP_LINES_COLUMNS).size);
  });
});
