/**
 * Citrus Game Day Suite — the puzzle artifact contract.
 *
 * ONE RULE governs this file: the browser renders artifacts, it never
 * generates puzzles. Every field below is written once, by a scheduled
 * Python job in `data-pipeline/gameday/`, into an immutable dated JSON
 * document. The web app fetches that document from a CDN and does nothing
 * but read it. If you find yourself wanting to add a field the client has
 * to *compute* a puzzle from, the computation belongs in the generator.
 *
 * WHY THE PAYLOADS ARE COLUMNAR. The daily player game ships the whole
 * guessable roster so that typing a guess costs zero network round trips
 * on a congested phone. As a list of objects that roster is ~150 KB; as
 * parallel arrays against a small dictionary it is ~40 KB (~14 KB over the
 * wire gzipped). The burst-load constraint — near-zero traffic, then
 * thousands of concurrent sessions — is why the shape looks like this
 * rather than like a comfortable REST response.
 *
 * ON `answer`. The answer travels inside the artifact, lightly obfuscated
 * (see `packages/shared/src/utils/gameDay.ts`). This is deliberate and it
 * is NOT a security control: any puzzle a client can grade offline is a
 * puzzle a determined client can spoil, exactly as Wordle's answer list
 * sits in its JS bundle. The obfuscation stops an idle devtools glance,
 * nothing more. Grading offline is what buys us a zero-server burst path,
 * and a daily puzzle is self-policing — cheating costs the cheater the
 * only thing the game offers.
 */

/** Bumped only when a change breaks clients that already shipped. */
export const GAME_DAY_SCHEMA_VERSION = 1;

/**
 * Every puzzle date is a calendar date in this zone, matching the rest of
 * Citrus (`packages/shared/src/utils/timezone.ts`). A player in Halifax and
 * a player in Vancouver get the same puzzle, and it rolls over at midnight
 * Mountain for both.
 */
export const GAME_DAY_TIMEZONE = 'America/Denver';

export type GameDayGameKey =
  | 'daily_player'
  | 'higher_or_lower'
  | 'constraint_grid'
  | 'find_the_hole';

export const GAME_DAY_GAME_KEYS: readonly GameDayGameKey[] = [
  'daily_player',
  'higher_or_lower',
  'constraint_grid',
  'find_the_hole',
] as const;

export type GameDayDifficultyBand = 'easy' | 'medium' | 'hard' | 'brutal';

export const GAME_DAY_DIFFICULTY_BANDS: readonly GameDayDifficultyBand[] = [
  'easy',
  'medium',
  'hard',
  'brutal',
] as const;

/**
 * Every generator emits one of these next to its puzzle. `score` is 0-100
 * and rises with difficulty; `band` is the bucket the score falls in;
 * `drivers` is the generator's own explanation of the score, so a puzzle
 * that felt wrong can be argued with after the fact instead of guessed at.
 */
export interface GameDayDifficulty {
  score: number;
  band: GameDayDifficultyBand;
  drivers: Record<string, number>;
}

/** The envelope every emitted artifact shares. */
export interface GameDayArtifact<K extends GameDayGameKey, P> {
  schema_version: number;
  game: K;
  /** `YYYY-MM-DD` in {@link GAME_DAY_TIMEZONE}. */
  puzzle_date: string;
  /** `${game}:${puzzle_date}`. Stable, and the obfuscation key for `answer`. */
  puzzle_id: string;
  /** ISO 8601, UTC. When the generator ran, not when the puzzle is for. */
  generated_at: string;
  /** Semver of the emitting generator, so a bad batch can be identified. */
  generator_version: string;
  difficulty: GameDayDifficulty;
  payload: P;
}

// ─────────────────────────────────────────────────────────────────────────
// Game 1 — Daily player guess
// ─────────────────────────────────────────────────────────────────────────

export interface GameDayTeamRef {
  /** NHL abbreviation, e.g. `EDM`. Matches `player_directory.team_abbrev`. */
  code: string;
  /** Short club name, e.g. `Oilers`. */
  name: string;
  division: string;
  conference: string;
}

/**
 * The index spaces the columnar roster refers to. Emitted per puzzle rather
 * than hardcoded in the client so that a franchise move, a new division
 * alignment or a change to the point bands is a generator change and a
 * fresh artifact — never a client deploy.
 */
export interface DailyPlayerDictionary {
  teams: GameDayTeamRef[];
  /** e.g. `['C','LW','RW','D']`. Goalies are out of this game — see below. */
  positions: string[];
  /** e.g. `['L','R']`. */
  hands: string[];
  /** Ascending, human-readable, e.g. `['0-9','10-24', ...]`. */
  point_bands: string[];
  /** Which season the team / position / points attributes describe. */
  attribute_season: number;
  /**
   * Positions that count as "close" to each other for feedback, as groups of
   * indices into `positions` — forwards are near-misses for each other, a
   * defenceman is not.
   */
  position_groups: number[][];
}

/**
 * Parallel arrays. Every array has the same length; index `i` is one player.
 * Short keys are not premature optimisation — they are ~8% of the payload.
 *
 * GOALIES ARE EXCLUDED, deliberately. A goalie has no meaningful point band,
 * so including them would either need a second feedback vocabulary or would
 * make one of the five attributes dead for ~10% of answers. Guessing a goalie
 * would then also burn an attempt on a player that can never be the answer.
 * Skaters only, and the copy says so.
 */
export interface DailyPlayerRoster {
  /** `player_directory.player_id`. */
  id: number[];
  /** `player_directory.full_name`. */
  n: string[];
  /** Index into `dictionary.teams`; -1 when the player has no club. */
  t: number[];
  /** Index into `dictionary.positions`. */
  p: number[];
  /** Index into `dictionary.hands`; -1 when unknown. */
  h: number[];
  /** Draft year; 0 for undrafted or unknown. */
  d: number[];
  /** Index into `dictionary.point_bands`. */
  b: number[];
}

export interface DailyPlayerPayload {
  dictionary: DailyPlayerDictionary;
  roster: DailyPlayerRoster;
  max_attempts: number;
  /**
   * Obfuscated JSON of {@link DailyPlayerAnswer}. Decode with
   * `decodeGameDayAnswer(payload.answer, artifact.puzzle_id)`.
   */
  answer: string;
}

/** What sits inside `DailyPlayerPayload.answer` once decoded. */
export interface DailyPlayerAnswer {
  player_id: number;
  name: string;
  /** Index into the dictionary, same spaces as the roster columns. */
  team: number;
  position: number;
  hand: number;
  draft_year: number;
  band: number;
  /** Full URL, present only for the answer — the roster carries none. */
  headshot_url: string | null;
  /** Actual season point total, shown only in the reveal. */
  points: number;
  /** Games played in `attribute_season`, shown only in the reveal. */
  games_played: number;
}

export type GameDayDailyPlayerArtifact = GameDayArtifact<'daily_player', DailyPlayerPayload>;

// ─────────────────────────────────────────────────────────────────────────
// Feedback vocabulary (shared by the client, the share card and the tests)
// ─────────────────────────────────────────────────────────────────────────

/**
 * `exact` — the guess matches the answer on this attribute.
 * `close`  — same division / same position group / draft year within
 *            `DAILY_PLAYER_DRAFT_YEAR_TOLERANCE` / adjacent point band.
 * `wrong`  — neither.
 * `unknown`— the guess or the answer has no value for this attribute
 *            (an undrafted player's draft year, a missing handedness).
 *            Rendered plainly rather than scored, so a data gap never reads
 *            as a wrong answer.
 */
export type GameDayVerdict = 'exact' | 'close' | 'wrong' | 'unknown';

export type GameDayDirection = 'higher' | 'lower' | null;

export interface GameDayAttributeFeedback {
  verdict: GameDayVerdict;
  /** Set for ordered attributes only: draft year and point band. */
  direction: GameDayDirection;
}

export interface DailyPlayerGuessFeedback {
  player_id: number;
  name: string;
  team: GameDayAttributeFeedback;
  position: GameDayAttributeFeedback;
  hand: GameDayAttributeFeedback;
  draft_year: GameDayAttributeFeedback;
  point_band: GameDayAttributeFeedback;
}

/** The order the five columns appear in, in the UI and in the share grid. */
export const DAILY_PLAYER_ATTRIBUTE_ORDER = [
  'team',
  'position',
  'hand',
  'draft_year',
  'point_band',
] as const;

export type DailyPlayerAttribute = (typeof DAILY_PLAYER_ATTRIBUTE_ORDER)[number];

/** A draft year this far from the answer's still earns a `close`. */
export const DAILY_PLAYER_DRAFT_YEAR_TOLERANCE = 3;
