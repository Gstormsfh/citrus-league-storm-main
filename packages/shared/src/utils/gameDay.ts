/**
 * Citrus Game Day Suite — pure functions shared by the web app, the share
 * card and the generator's test fixtures.
 *
 * Everything here is deterministic and dependency-free. The generator's
 * Python twin lives at `data-pipeline/gameday/codec.py`, and
 * `packages/shared/src/utils/__tests__/gameDay.test.ts` pins the two against
 * a shared vector so they cannot drift apart silently — a drifted codec
 * means every phone in the country shows a puzzle with an unreadable answer.
 */

import { getTodayMST } from './timezone';
import {
  DAILY_PLAYER_DRAFT_YEAR_TOLERANCE,
  type DailyPlayerAnswer,
  type DailyPlayerDictionary,
  type DailyPlayerGuessFeedback,
  type DailyPlayerRoster,
  type GameDayAttributeFeedback,
  type GameDayGameKey,
  type GameDayVerdict,
} from '../types/gameDay';

// ─────────────────────────────────────────────────────────────────────────
// Puzzle identity
// ─────────────────────────────────────────────────────────────────────────

/**
 * Today's puzzle date. Mountain Time, because that is the one clock the rest
 * of Citrus runs on; a user in Halifax gets the same puzzle as a user in
 * Vancouver, and it turns over at midnight MT for both of them.
 */
export function gameDayPuzzleDate(): string {
  return getTodayMST();
}

/** The `YYYY-MM-DD` that came `days` before `date`. Pure calendar math. */
export function gameDayShiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export function gameDayPuzzleId(game: GameDayGameKey, puzzleDate: string): string {
  return `${game}:${puzzleDate}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Answer obfuscation
// ─────────────────────────────────────────────────────────────────────────
//
// NOT ENCRYPTION. Read the `answer` note in `types/gameDay.ts` before you
// reach for something stronger: any puzzle graded on the client can be
// spoiled on the client, and grading on the client is what keeps the burst
// path off our servers. This exists so that opening devtools mid-game does
// not print the answer in plain sight. A keystream from a seeded PRNG is
// used rather than a hash so that both sides stay synchronous — the browser
// grades a guess inside a keypress handler, where `crypto.subtle`'s promise
// would be a needless await.

/** FNV-1a, 32-bit. Same constants in `codec.py`. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** xorshift32. Never seeded with 0 — that is the generator's fixed point. */
function makeKeystream(seedText: string): () => number {
  let state = fnv1a32(seedText) || 0x9e3779b9;
  return () => {
    state ^= (state << 13) >>> 0;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    state >>>= 0;
    return state & 0xff;
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeGameDayAnswer(answer: unknown, puzzleId: string): string {
  const plain = new TextEncoder().encode(JSON.stringify(answer));
  const next = makeKeystream(puzzleId);
  const cipher = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i += 1) cipher[i] = plain[i] ^ next();
  return bytesToBase64(cipher);
}

export function decodeGameDayAnswer<T>(encoded: string, puzzleId: string): T {
  const cipher = base64ToBytes(encoded);
  const next = makeKeystream(puzzleId);
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i += 1) plain[i] = cipher[i] ^ next();
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// ─────────────────────────────────────────────────────────────────────────
// Game 1 — grading a guess
// ─────────────────────────────────────────────────────────────────────────

function verdict(exact: boolean, close: boolean): GameDayVerdict {
  if (exact) return 'exact';
  return close ? 'close' : 'wrong';
}

/** Ordered attributes point at the answer; unordered ones return null. */
function directionOf(guess: number, answer: number): 'higher' | 'lower' | null {
  if (guess === answer) return null;
  return guess < answer ? 'higher' : 'lower';
}

function sameDivision(a: number, b: number, dictionary: DailyPlayerDictionary): boolean {
  const teamA = dictionary.teams[a];
  const teamB = dictionary.teams[b];
  if (!teamA || !teamB) return false;
  return teamA.division === teamB.division;
}

function samePositionGroup(a: number, b: number, dictionary: DailyPlayerDictionary): boolean {
  return dictionary.position_groups.some((group) => group.includes(a) && group.includes(b));
}

/**
 * Grade one guess against the answer.
 *
 * `rosterIndex` is the guessed player's index into the columnar roster, which
 * is how the UI addresses a player everywhere — the search box resolves a
 * typed name to an index once and never touches a player object again.
 */
export function gradeDailyPlayerGuess(
  rosterIndex: number,
  roster: DailyPlayerRoster,
  answer: DailyPlayerAnswer,
  dictionary: DailyPlayerDictionary,
): DailyPlayerGuessFeedback {
  const team = roster.t[rosterIndex];
  const position = roster.p[rosterIndex];
  const hand = roster.h[rosterIndex];
  const draftYear = roster.d[rosterIndex];
  const band = roster.b[rosterIndex];

  const teamFeedback: GameDayAttributeFeedback = {
    verdict:
      team < 0 || answer.team < 0
        ? 'unknown'
        : verdict(team === answer.team, sameDivision(team, answer.team, dictionary)),
    direction: null,
  };

  const positionFeedback: GameDayAttributeFeedback = {
    verdict: verdict(
      position === answer.position,
      samePositionGroup(position, answer.position, dictionary),
    ),
    direction: null,
  };

  // Handedness is binary: there is no near-miss between a lefty and a righty.
  const handFeedback: GameDayAttributeFeedback = {
    verdict: hand < 0 || answer.hand < 0 ? 'unknown' : verdict(hand === answer.hand, false),
    direction: null,
  };

  // A 0 means undrafted or unrecorded. Scoring it would tell the player that
  // the answer is undrafted, which is a much bigger hint than the column is
  // meant to give, so it stays unscored on either side.
  const draftFeedback: GameDayAttributeFeedback =
    draftYear === 0 || answer.draft_year === 0
      ? { verdict: 'unknown', direction: null }
      : {
          verdict: verdict(
            draftYear === answer.draft_year,
            Math.abs(draftYear - answer.draft_year) <= DAILY_PLAYER_DRAFT_YEAR_TOLERANCE,
          ),
          direction: directionOf(draftYear, answer.draft_year),
        };

  const bandFeedback: GameDayAttributeFeedback = {
    verdict: verdict(band === answer.band, Math.abs(band - answer.band) === 1),
    direction: directionOf(band, answer.band),
  };

  return {
    player_id: roster.id[rosterIndex],
    name: roster.n[rosterIndex],
    team: teamFeedback,
    position: positionFeedback,
    hand: handFeedback,
    draft_year: draftFeedback,
    point_band: bandFeedback,
  };
}

export function isDailyPlayerSolved(feedback: DailyPlayerGuessFeedback, answerId: number): boolean {
  return feedback.player_id === answerId;
}

// ─────────────────────────────────────────────────────────────────────────
// Share card — the emoji grid
// ─────────────────────────────────────────────────────────────────────────

/**
 * SPOILER-FREE IS THE WHOLE POINT. The grid says how the run went and
 * nothing about who the player was: no names, no teams, no attribute values,
 * and no ordering that could be reversed into one. A reader who has not
 * played yet must lose nothing by seeing it in a group chat.
 */
const VERDICT_SQUARE: Record<GameDayVerdict, string> = {
  exact: '🟩',
  close: '🟨',
  wrong: '⬛',
  unknown: '⬜',
};

export function dailyPlayerShareGrid(
  feedbacks: DailyPlayerGuessFeedback[],
  maxAttempts: number,
  solved: boolean,
): string {
  const rows = feedbacks.map((f) =>
    [f.team, f.position, f.hand, f.draft_year, f.point_band]
      .map((a) => VERDICT_SQUARE[a.verdict])
      .join(''),
  );
  const tally = solved ? `${feedbacks.length}/${maxAttempts}` : `X/${maxAttempts}`;
  return `${tally}\n${rows.join('\n')}`;
}

export function dailyPlayerShareText(
  puzzleDate: string,
  feedbacks: DailyPlayerGuessFeedback[],
  maxAttempts: number,
  solved: boolean,
  wordmark: string,
): string {
  return `${wordmark} · ${puzzleDate}\n${dailyPlayerShareGrid(feedbacks, maxAttempts, solved)}`;
}
