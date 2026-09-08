/**
 * Game Day Suite — the browser half of the contract.
 *
 * The vector in the first block is the SAME vector pinned by
 * `data-pipeline/tests/test_gameday_generator.py`. The generator obfuscates
 * an answer in Python; this code decodes it in the browser. If the two
 * implementations drift, the cron goes green, the artifact publishes, and
 * every phone shows a puzzle whose answer will not decode — a failure with
 * no error message anywhere in the stack. Hence a literal, hand-checked
 * expected string rather than a round-trip through our own encoder, which
 * would agree with itself no matter how wrong it was.
 */
import { describe, expect, it } from 'vitest';
import {
  dailyPlayerShareGrid,
  dailyPlayerShareText,
  decodeGameDayAnswer,
  encodeGameDayAnswer,
  gameDayPuzzleId,
  gameDayShiftDate,
  gradeDailyPlayerGuess,
} from '../gameDay';
import type {
  DailyPlayerAnswer,
  DailyPlayerDictionary,
  DailyPlayerGuessFeedback,
  DailyPlayerRoster,
} from '../../types/gameDay';

const VECTOR_PUZZLE_ID = 'daily_player:2026-09-06';
const VECTOR_ANSWER = {
  player_id: 8478402,
  name: 'Tim Stützle',
  team: 3,
  position: 0,
  hand: 0,
  draft_year: 2020,
  band: 4,
  headshot_url: null,
  points: 71,
  games_played: 78,
};
const VECTOR_ENCODED =
  'Kx+ZDPQNzp+JvngwNeUPx8fkkhCo+ILf7V3Fw+cVuvHJoliFWIJo9qjQZ5kLMQrDz6wseSvenTFqG0s5' +
  'a1IjkJteCzet4BxY3jYndsrQbSOY1Km0MPurVg4HQEhQKvQvhLp08WWmWVTHBOXeMnX6ohsDxBXdgdSu' +
  'A1Z7a4Sr3cgAjX1S7gMNzShXxlJy3ppnr/s8EfPEEw==';

describe('answer codec — parity with the Python generator', () => {
  it('produces the byte-for-byte vector the generator produces', () => {
    expect(encodeGameDayAnswer(VECTOR_ANSWER, VECTOR_PUZZLE_ID)).toBe(VECTOR_ENCODED);
  });

  it('decodes what the generator emitted, non-ASCII names included', () => {
    const decoded = decodeGameDayAnswer<typeof VECTOR_ANSWER>(VECTOR_ENCODED, VECTOR_PUZZLE_ID);
    expect(decoded).toEqual(VECTOR_ANSWER);
    expect(decoded.name).toBe('Tim Stützle');
  });

  it('will not decode under the wrong puzzle id', () => {
    expect(() => decodeGameDayAnswer(VECTOR_ENCODED, 'daily_player:2026-09-07')).toThrow();
  });

  it('builds the puzzle id the artifact path is keyed on', () => {
    expect(gameDayPuzzleId('daily_player', '2026-09-06')).toBe(VECTOR_PUZZLE_ID);
  });
});

describe('gameDayShiftDate', () => {
  it('walks back across a month boundary', () => {
    expect(gameDayShiftDate('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('walks back across a year boundary', () => {
    expect(gameDayShiftDate('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles a leap day', () => {
    expect(gameDayShiftDate('2028-03-01', -1)).toBe('2028-02-29');
  });
});

// ── Grading ───────────────────────────────────────────────────────────────

const dictionary: DailyPlayerDictionary = {
  teams: [
    { code: 'EDM', name: 'Oilers', division: 'Pacific', conference: 'Western' },
    { code: 'CGY', name: 'Flames', division: 'Pacific', conference: 'Western' },
    { code: 'TOR', name: 'Maple Leafs', division: 'Atlantic', conference: 'Eastern' },
  ],
  positions: ['C', 'LW', 'RW', 'D'],
  hands: ['L', 'R'],
  point_bands: ['0-9', '10-24', '25-39', '40-59', '60-79', '80+'],
  attribute_season: 2025,
  position_groups: [[0, 1, 2], [3]],
};

//        index:      0        1        2        3        4
const roster: DailyPlayerRoster = {
  id: [1, 2, 3, 4, 5],
  n: ['Answer', 'SameDivision', 'OtherConference', 'Undrafted', 'NoClub'],
  t: [0, 1, 2, 0, -1],
  p: [0, 1, 3, 0, 0],
  h: [0, 0, 1, 0, -1],
  d: [2015, 2017, 2019, 0, 2015],
  b: [3, 4, 0, 3, 3],
};

const answer: DailyPlayerAnswer = {
  player_id: 1,
  name: 'Answer',
  team: 0,
  position: 0,
  hand: 0,
  draft_year: 2015,
  band: 3,
  headshot_url: null,
  points: 44,
  games_played: 80,
};

const grade = (i: number) => gradeDailyPlayerGuess(i, roster, answer, dictionary);

describe('gradeDailyPlayerGuess', () => {
  it('marks the answer exact on every attribute', () => {
    const f = grade(0);
    for (const key of ['team', 'position', 'hand', 'draft_year', 'point_band'] as const) {
      expect(f[key].verdict).toBe('exact');
    }
    expect(f.draft_year.direction).toBeNull();
    expect(f.point_band.direction).toBeNull();
  });

  it('calls a divisional rival close, not wrong', () => {
    expect(grade(1).team.verdict).toBe('close');
  });

  it('calls a team from another division wrong', () => {
    expect(grade(2).team.verdict).toBe('wrong');
  });

  it('treats forwards as near misses for each other but not for a defenceman', () => {
    expect(grade(1).position.verdict).toBe('close'); // LW guessed, C is the answer
    expect(grade(2).position.verdict).toBe('wrong'); // D guessed
  });

  it('has no near miss for handedness — a lefty is not nearly a righty', () => {
    expect(grade(2).hand.verdict).toBe('wrong');
  });

  it('points at the answer for ordered attributes', () => {
    // Guess 1 was drafted in 2017 and the answer in 2015, so the answer is
    // EARLIER, and its band is LOWER than the guess's.
    const f = grade(1);
    expect(f.draft_year.verdict).toBe('close'); // within the 3-year tolerance
    expect(f.draft_year.direction).toBe('lower');
    expect(f.point_band.verdict).toBe('close'); // adjacent band
    expect(f.point_band.direction).toBe('lower');
  });

  it('points the other way when the guess is under the answer', () => {
    expect(grade(2).point_band.direction).toBe('higher');
    expect(grade(2).point_band.verdict).toBe('wrong'); // band 0 vs band 3
  });

  it('leaves a draft year unscored when either side is undrafted', () => {
    // Scoring it would leak that the ANSWER is drafted, which is a far bigger
    // hint than the column is meant to give.
    const f = grade(3);
    expect(f.draft_year.verdict).toBe('unknown');
    expect(f.draft_year.direction).toBeNull();
  });

  it('leaves team and handedness unscored when the guess has no value', () => {
    const f = grade(4);
    expect(f.team.verdict).toBe('unknown');
    expect(f.hand.verdict).toBe('unknown');
    // A data gap must not cascade: the attributes we DO have still grade.
    expect(f.point_band.verdict).toBe('exact');
  });

  it('carries the guessed player through for the UI to render', () => {
    expect(grade(2)).toMatchObject({ player_id: 3, name: 'OtherConference' });
  });
});

// ── Share card ────────────────────────────────────────────────────────────

describe('share grid', () => {
  const won: DailyPlayerGuessFeedback[] = [grade(2), grade(1), grade(0)];

  it('renders one row per guess and one square per attribute', () => {
    const grid = dailyPlayerShareGrid(won, 6, true);
    const lines = grid.split('\n');
    expect(lines[0]).toBe('3/6');
    expect(lines).toHaveLength(4);
    for (const line of lines.slice(1)) {
      expect([...line]).toHaveLength(5);
    }
    expect(lines[3]).toBe('🟩🟩🟩🟩🟩');
  });

  it('marks an unsolved run with X', () => {
    expect(dailyPlayerShareGrid([grade(2)], 6, false).split('\n')[0]).toBe('X/6');
  });

  it('gives away nothing about who the player was', () => {
    // The whole point of the share card. Any name, team code or attribute
    // value leaking here spoils the puzzle for everyone in the group chat.
    //
    // Checked two ways, because a substring scan alone is not enough: single
    // characters like the position code 'C' occur inside innocent words (the
    // wordmark "Citrus"), so the scan covers only multi-character secrets and
    // a separate assertion pins the grid body to emoji squares and nothing
    // else. Between them, no attribute value can reach the clipboard.
    const text = dailyPlayerShareText('2026-09-06', won, 6, true, 'Citrus Game Day');

    for (const secret of ['Answer', 'EDM', 'Oilers', '2015', '40-59', String(answer.player_id)]) {
      expect(text.includes(secret)).toBe(false);
    }

    const gridLines = dailyPlayerShareGrid(won, 6, true).split('\n').slice(1);
    for (const line of gridLines) {
      expect([...line].every((ch) => '🟩🟨⬛⬜'.includes(ch))).toBe(true);
    }

    expect(text).toContain('Citrus Game Day');
    expect(text).toContain('2026-09-06');
  });
});
