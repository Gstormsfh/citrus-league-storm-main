import type { SupabaseClient } from '@supabase/supabase-js';
import { logger, getCurrentSeason, selectEditorialNews, editorialNewsText } from '@citrus/shared';
import type { EditorialNewsItem } from '@citrus/shared';
import { PlayerOutlookService } from './PlayerOutlookService';

/**
 * Citrus News Engine — first-party player notes generated from our own data.
 *
 * WHY THIS EXISTS
 * ---------------
 * Sleeper's player cards carry Rotowire copy. We have no wire licence. What we
 * do have is six seasons of shot-quality data that a general news wire does
 * not, which means Citrus notes can say things a wire structurally cannot:
 * who out-ran their finishing, whose ice time moved, which goalie is actually
 * carrying a starter's load. That is a better answer than licensing someone
 * else's headlines, and it is entirely ours to byline.
 *
 * DESIGN: DETECTORS, NOT A SCRIPT
 * -------------------------------
 * Each finding is a `Detector` — an independent unit that owns its query, its
 * thresholds and its prose. Adding "point streaks" later means adding one
 * object to the array, not editing a monolith. Each declares a `phase` because
 * the useful thing to say in August is not the useful thing to say in January:
 * a detector that reports "3-point night" is nonsense in the offseason, and
 * one that reports "bounce-back candidate" is stale filler mid-season.
 *
 * EVERY THRESHOLD IS CALIBRATED, NOT GUESSED
 * ------------------------------------------
 * Run against the real 2025 season (940 skaters, 123 goalies) the detectors
 * select 23, 32, 57 and 4 players respectively. Numbers chosen so a note means
 * something: a detector that fires on 300 players is a list, not news.
 *
 * HONESTY RULES THIS FILE
 * -----------------------
 * Every sentence must be defensible from the row that produced it. No note
 * claims an injury, a trade, a line change or anything else we cannot see in
 * the data. Where the analysis is genuinely uncertain — elite shooters really
 * do beat their expected goals year after year — the copy says so instead of
 * overclaiming. That caveat is the difference between analysis and a horoscope.
 */

export type NoteSeverity = 'info' | 'positive' | 'caution';

export interface GeneratedNote {
  dedupeKey: string;
  kind: string;
  playerId: number | null;
  season: number;
  headline: string;
  body: string;
  analysis: string | null;
  severity: NoteSeverity;
  tags: string[];
  /**
   * When the note should claim to have been published, as an ISO string.
   *
   * Event detectors set this to the GAME DATE. A three-point night from
   * Tuesday must be stamped Tuesday even if the generator first runs on
   * Thursday — stamping it now() would be the same lie about time that the
   * fabricated news fallback told. Omitted for standing analysis (a
   * bounce-back read isn't an event), where the insert default of now() is
   * the honest answer.
   */
  publishedAt?: string;
  editorialVersion?: string;
  contentRevision?: string;
  sourceContext?: Record<string, unknown>;
}

interface ReadableCitrusNote {
  kind: string;
  headline?: string;
  tags?: string[];
  body: string;
  analysis: string | null;
  published_at?: string;
}

const LEGACY_UNSUPPORTED_ANALYSIS = /usually closes on its own|Buy him anywhere|What is hard to defend is paying|opportunity .+ tends to persist|a coaching decision rather than|holding a crease outright|stop worrying about the committee|being trusted with the crease|minutes and linemates to do it|jump in minutes is the part that lasts|undisputed crease|with a real backup behind him|Committee goalies win you|only if the starter ahead of him is fragile|start every week without checking|Only about 60 skaters|Roughly the top of the Citrus ROS|Right around the middle of the Citrus ROS|Below the median on the Citrus ROS/i;
const LEGACY_REPLACEMENTS: Record<string, string> = {
  'bounce-back': 'The gap identifies a difference between recorded chances and goals. Better conversion could help goals categories if those opportunities persist; the gap alone does not guarantee a rebound or establish draft value.',
  'regression-risk': 'The goals above expected make finishing an important part of the recorded result. Compare the longer scoring record and shot volume before assuming either the goal total or the xG estimate is the next baseline.',
  'usage-surge': 'More ice time supplied additional opportunity in the cited season. Check the current line and power-play assignment before assuming those minutes will continue or produce more points.',
  'goalie-workload': 'The recorded appearances supplied opportunities for saves and wins. Appearances can include relief work and do not establish future starts; ratio categories still depend on performance.',
  'big-game': 'The goals, assists and shots in this game describe its category contribution. A single scoring night does not establish a lasting deployment change.',
  'goalie-gem': 'The saves and goals allowed describe this game’s counting-stat and ratio contribution. Shots faced do not establish ownership of the crease or future starts.',
  'point-streak': 'The goal and assist mix describes what the run contributed. A scoring streak alone does not identify linemates, sustained shot volume or a permanent role change.',
  'season-outlook': 'These are model estimates for the stated projection season. Their value depends on league scoring and usable games; projected appearances or fantasy points do not confirm a lineup role or an unconditional start.',
};

/** Read-time enrichment keeps fresh reporting on its own clock and out of
 * persisted historical notes. Publisher text, never its generated summary,
 * supplies evidence. Missing identity/news leaves the data-backed note usable.
 */
export function augmentCitrusNotesWithNews<T extends ReadableCitrusNote>(
  notes: readonly T[],
  player: { id: number; name: string } | null,
  items: readonly EditorialNewsItem[] | null | undefined,
  now: Date = new Date(),
): Array<T & { news_sources?: Array<{ source: string; url: string; published_at: string }> }> {
  const clean = notes.map((note) => {
    const body = note.body.split('\n\nCurrent report: ')[0];
    const original = note.analysis?.split(/(?:^|\n\n)News implication: /)[0] || null;
    const analysis = original && LEGACY_UNSUPPORTED_ANALYSIS.test(original)
      ? LEGACY_REPLACEMENTS[note.kind] || original : original;
    // Clear old read-time sources before selecting the current evidence.
    const { news_sources: _previous, ...base } = note as T & { news_sources?: unknown };
    const headline = note.headline?.replace('Clear starter', 'High projected volume')
      .replace("Starter's share", 'Regular projected workload').replace('Committee crease', 'Partial-season volume')
      .replace('Outlook: Backup', 'Outlook: Limited projected volume')
      .replace("carried a true starter's workload", 'recorded substantial appearance volume');
    const tags = note.tags?.filter((tag) => !['Buy-low', 'Sell-high', 'Clear starter', "Starter's share", 'Committee crease', 'Backup'].includes(tag));
    return { ...base, body, analysis, ...(headline === undefined ? {} : { headline }), ...(tags === undefined ? {} : { tags }) } as T;
  });
  if (!player || !clean.length) return clean;
  const evidence = selectEditorialNews(player, items, now);
  if (!evidence.length) return clean;
  const latest = clean.reduce((best, note, i) => {
    const at = Date.parse(note.published_at || '') || 0;
    const bestAt = Date.parse(clean[best].published_at || '') || 0;
    return at > bestAt ? i : best;
  }, 0);
  const text = editorialNewsText(player.name, evidence);
  return clean.map((note, i) => i !== latest ? note : {
    ...note,
    body: `${note.body}\n\nCurrent report: ${text.summary}`,
    analysis: `${note.analysis || ''}${note.analysis ? '\n\n' : ''}News implication: ${text.analysis}`,
    news_sources: evidence.map((e) => ({ source: e.source, url: e.url, published_at: e.publishedAt })),
  });
}

/** Which part of the calendar a detector has something true to say in. */
export type DetectorPhase = 'offseason' | 'inseason' | 'always';

export interface Detector {
  kind: string;
  label: string;
  phase: DetectorPhase;
  /** `now` is injected rather than read from the clock so detectors are testable at a fixed date. */
  run(supabase: SupabaseClient, season: number, now: Date): Promise<GeneratedNote[]>;
}

/** One decimal, without a trailing ".0" on whole numbers. */
function fmt(n: number, decimals = 1): string {
  return Number(n.toFixed(decimals)).toString();
}
function seasonLabel(season: number): string {
  return `${season}-${String(season + 1).slice(-2)}`;
}

interface SkaterRow {
  player_id: number;
  games_played: number;
  goals: number;
  points: number;
  x_goals: number;
  icetime_seconds: number;
}

interface GoalieRow {
  player_id: number;
  goalie_gp: number;
  save_pct: number;
  wins: number;
  shutouts: number;
  goals_against: number;
}

interface DirectoryRow {
  player_id: number;
  full_name: string;
  team_abbrev: string | null;
  position_code: string | null;
}

/**
 * Page size for every table read in this file.
 *
 * PostgREST caps a response at 1,000 rows by DEFAULT and reports no error when
 * it truncates — it just returns the first 1,000. player_directory holds 1,076
 * rows for 2025, so an unpaginated read silently loses ~76 players; every
 * detector then skips them for "no name" and the miss is invisible. Season
 * tables sit right at the boundary, so everything here pages explicitly.
 */
const PAGE_SIZE = 1000;

/** Read an entire table selection, page by page, instead of trusting one call. */
async function fetchAllRows<T>(
  build: () => any,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label} failed: ${error.message}`);
    const page = (data || []) as T[];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

/** Season-scoped skater/goalie stat selection, fully paginated. */
function seasonStats(supabase: SupabaseClient, columns: string, season: number, isGoalie: boolean) {
  return () =>
    supabase
      .from('player_season_stats')
      .select(columns)
      .eq('season', season)
      .eq('is_goalie', isGoalie);
}

/**
 * player_season_stats is keyed by integer NHL id and carries no names;
 * player_directory is the season-scoped identity table. Fetched once per
 * generation run and shared by every detector rather than joined per query.
 */
async function loadDirectory(
  supabase: SupabaseClient,
  season: number,
): Promise<Map<number, DirectoryRow>> {
  const rows = await fetchAllRows<DirectoryRow>(
    () =>
      supabase
        .from('player_directory')
        .select('player_id, full_name, team_abbrev, position_code')
        .eq('season', season),
    'player_directory load',
  );

  const map = new Map<number, DirectoryRow>();
  for (const row of rows) map.set(row.player_id, row);
  return map;
}

/** Surname-first reference after the full name has been used once. */
function lastName(fullName: string): string {
  const parts = (fullName || '').trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

// ── Detector 1: bounce-back candidates ───────────────────────────────
// Scored far fewer goals than their chances deserved. The single most
// actionable offseason finding, because draft position anchors on last
// season's goal total and shooting percentage is the noisiest number on a
// stat sheet.
const bounceBackDetector: Detector = {
  kind: 'bounce-back',
  label: 'Bounce-back candidates',
  phase: 'offseason',
  async run(supabase, season) {
    const directory = await loadDirectory(supabase, season);
    const rows = await fetchAllRows<SkaterRow>(
      () => seasonStats(supabase, 'player_id, games_played, goals, points, x_goals, icetime_seconds', season, false)().gte('games_played', 40),
      'bounce-back query',
    );

    const notes: GeneratedNote[] = [];
    for (const row of rows) {
      const xg = Number(row.x_goals);
      const goals = Number(row.goals);
      if (!Number.isFinite(xg) || xg < 12) continue;
      if (goals > xg * 0.7) continue;

      const person = directory.get(row.player_id);
      if (!person?.full_name) continue;

      const shortfall = xg - goals;
      const surname = lastName(person.full_name);

      notes.push({
        dedupeKey: `bounce-back:${season}:${row.player_id}`,
        kind: 'bounce-back',
        playerId: row.player_id,
        season,
        headline: `${person.full_name} generated ${fmt(xg)} goals' worth of chances and scored ${goals}`,
        body:
          `${person.full_name} finished ${seasonLabel(season)} with ${goals} goals in ${row.games_played} games. ` +
          `Citrus xG v3 had him at ${fmt(xg)} expected, a shortfall of ${fmt(shortfall)}. ` +
          `His goal total fell short of the model's estimate for those chances.`,
        analysis:
          `${surname}'s ${fmt(shortfall)}-goal gap separates chance creation from the scoring that reached the standings. ` +
          `If he maintains those opportunities and converts more of them, goals are the category with room to improve. ` +
          `The gap alone does not establish bad luck or guarantee a rebound; compare his multi-season finishing and current deployment before paying for one.`,
        severity: 'positive',
        tags: ['Bounce-back', 'Finishing gap', 'xG'],
      });
    }
    return notes;
  },
};

// ── Detector 2: regression risks ─────────────────────────────────────
const regressionRiskDetector: Detector = {
  kind: 'regression-risk',
  label: 'Regression risks',
  phase: 'offseason',
  async run(supabase, season) {
    const directory = await loadDirectory(supabase, season);
    const rows = await fetchAllRows<SkaterRow>(
      () => seasonStats(supabase, 'player_id, games_played, goals, points, x_goals, icetime_seconds', season, false)().gte('games_played', 40).gte('goals', 20),
      'regression-risk query',
    );

    const notes: GeneratedNote[] = [];
    for (const row of rows) {
      const xg = Number(row.x_goals);
      const goals = Number(row.goals);
      if (!Number.isFinite(xg) || goals < xg * 1.35) continue;

      const person = directory.get(row.player_id);
      if (!person?.full_name) continue;

      const over = goals - xg;
      const surname = lastName(person.full_name);

      notes.push({
        dedupeKey: `regression-risk:${season}:${row.player_id}`,
        kind: 'regression-risk',
        playerId: row.player_id,
        season,
        headline: `${person.full_name} scored ${goals} on ${fmt(xg)} expected goals`,
        body:
          `${person.full_name} put up ${goals} goals in ${row.games_played} games in ${seasonLabel(season)} against ${fmt(xg)} expected ` +
          `on Citrus xG v3, finishing ${fmt(over)} goals above what the quality of his chances predicted.`,
        analysis:
          `This is a flag, not a verdict: elite shooters can sustain above-model finishing. ` +
          `${surname}'s ${fmt(over)} goals above expected make finishing an important part of the result, ` +
          `so a goals-heavy valuation is more exposed if conversion falls. Check his longer scoring record and shot volume before treating either ${goals} goals or the xG estimate as the next baseline.`,
        severity: 'caution',
        tags: ['Regression risk', 'Finishing premium', 'xG'],
      });
    }
    return notes;
  },
};

// ── Detector 3: usage surge ──────────────────────────────────────────
// Year-over-year ice time identifies a change in opportunity. It does not
// identify coaching intent, even-strength lines, or power-play deployment.
const usageSurgeDetector: Detector = {
  kind: 'usage-surge',
  label: 'Usage risers',
  phase: 'offseason',
  async run(supabase, season) {
    const prevSeason = season - 1;
    const directory = await loadDirectory(supabase, season);

    const [curRows, prevRows] = await Promise.all([
      fetchAllRows<SkaterRow>(
        () => seasonStats(supabase, 'player_id, games_played, goals, points, x_goals, icetime_seconds', season, false)().gte('games_played', 40),
        'usage-surge current query',
      ),
      fetchAllRows<SkaterRow>(
        () => seasonStats(supabase, 'player_id, games_played, goals, points, x_goals, icetime_seconds', prevSeason, false)().gte('games_played', 40),
        'usage-surge previous query',
      ),
    ]);

    const perGameToi = (row: SkaterRow): number | null => {
      const gp = Number(row.games_played);
      const secs = Number(row.icetime_seconds);
      if (!gp || !Number.isFinite(secs) || secs <= 0) return null;
      return secs / gp / 60;
    };

    const prevToi = new Map<number, number>();
    for (const row of prevRows) {
      const toi = perGameToi(row);
      if (toi !== null) prevToi.set(row.player_id, toi);
    }

    const notes: GeneratedNote[] = [];
    for (const row of curRows) {
      const now = perGameToi(row);
      const before = prevToi.get(row.player_id);
      if (now === null || before === undefined) continue;

      const delta = now - before;
      if (delta < 2.0) continue;

      const person = directory.get(row.player_id);
      if (!person?.full_name) continue;

      const surname = lastName(person.full_name);
      notes.push({
        dedupeKey: `usage-surge:${season}:${row.player_id}`,
        kind: 'usage-surge',
        playerId: row.player_id,
        season,
        headline: `${person.full_name}'s ice time jumped ${fmt(delta)} minutes a night`,
        body:
          `${person.full_name} averaged ${fmt(now)} minutes per game in ${seasonLabel(season)} on the Citrus season ` +
          `file, up from ${fmt(before)} ${seasonLabel(season - 1)}, a ${fmt(delta)}-minute jump across ${row.games_played} games.`,
        analysis:
          `${surname} had ${fmt(delta)} more minutes per game to accumulate counting stats. ` +
          `That adds opportunity if it carries forward, but total ice time does not show how much came on the power play or which linemates shared it. ` +
          `Check the current assignment before translating the larger workload into more points.`,
        severity: 'positive',
        tags: ['Usage', 'Opportunity', 'Breakout watch'],
      });
    }
    return notes;
  },
};

// ── Detector 4: goalie workload ──────────────────────────────────────
// Starts are most of a fantasy goalie's value, so "who actually owns a crease"
// is the question worth answering.
const goalieWorkloadDetector: Detector = {
  kind: 'goalie-workload',
  label: 'Workhorse goalies',
  phase: 'offseason',
  async run(supabase, season) {
    const directory = await loadDirectory(supabase, season);
    const rows = await fetchAllRows<GoalieRow>(
      () =>
        seasonStats(
          supabase,
          'player_id, goalie_gp, save_pct, wins, shutouts, goals_against',
          season,
          true,
        )().gte('goalie_gp', 45),
      'goalie-workload query',
    );

    const notes: GeneratedNote[] = [];
    for (const row of rows) {
      const savePct = Number(row.save_pct);
      if (!Number.isFinite(savePct) || savePct < 0.91) continue;

      const person = directory.get(row.player_id);
      if (!person?.full_name) continue;

      const surname = lastName(person.full_name);
      const savePctLabel = savePct.toFixed(3).replace(/^0/, '');

      notes.push({
        dedupeKey: `goalie-workload:${season}:${row.player_id}`,
        kind: 'goalie-workload',
        playerId: row.player_id,
        season,
        headline: `${person.full_name} logged ${row.goalie_gp} appearances with a ${savePctLabel} save percentage`,
        body:
          `${person.full_name} appeared in ${row.goalie_gp} games in ${seasonLabel(season)} with a ${savePctLabel} save ` +
          `percentage${row.wins ? ` and ${row.wins} wins` : ''}` +
          `${row.shutouts ? `, including ${row.shutouts} shutout${row.shutouts === 1 ? '' : 's'}` : ''}.`,
        analysis:
          `${surname} combined ${row.goalie_gp} appearances with a ${savePctLabel} save percentage in ${seasonLabel(season)}. ` +
          `More games can build saves and wins in leagues that reward volume, while ratio categories still depend on performance in those games. ` +
          `Appearances include relief work and do not establish next season's starts or an uncontested crease.`,
        severity: 'positive',
        tags: ['Goalie', 'Workload', 'Volume'],
      });
    }
    return notes;
  },
};


// ═══════════════════════════════════════════════════════════════════════
// IN-SEASON DETECTORS
// ═══════════════════════════════════════════════════════════════════════
//
// These report EVENTS, so two rules apply that the offseason detectors don't
// need:
//
//   1. A LOOKBACK WINDOW. Without one, the first run mid-season would emit a
//      note for every three-point game played all year — roughly 43 per week
//      across a full season, which is an archive dump, not a news feed.
//   2. HONEST TIMESTAMPS. publishedAt is the GAME date, not the moment the
//      generator happened to run.

/** How far back an event detector looks. Sized to survive a missed cron run. */
const EVENT_LOOKBACK_DAYS = 3;

/** How much history the streak detector needs to measure a run backwards. */
const STREAK_LOOKBACK_DAYS = 45;

interface GameRow {
  player_id: number;
  game_id: number;
  game_date: string;
  team_abbrev: string | null;
  points: number;
  goals: number;
  primary_assists: number;
  secondary_assists: number;
  shots_on_goal: number;
  icetime_seconds: number;
  saves: number;
  shots_faced: number;
  goals_against: number;
  shutouts: number;
  wins: number;
}

const GAME_COLUMNS =
  'player_id, game_id, game_date, team_abbrev, points, goals, primary_assists, ' +
  'secondary_assists, shots_on_goal, icetime_seconds, saves, shots_faced, ' +
  'goals_against, shutouts, wins';

function isoDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

/** "Tuesday" — game dates are plain YYYY-MM-DD, so parse at local midnight. */
function weekdayName(gameDate: string): string {
  const d = new Date(`${gameDate}T00:00:00`);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[d.getDay()] ?? 'game night';
}

/** Noon UTC on the game date — inside the day in every timezone the app serves. */
function gameDateToTimestamp(gameDate: string): string {
  return `${gameDate}T12:00:00.000Z`;
}

async function fetchGamesSince(
  supabase: SupabaseClient,
  season: number,
  sinceDate: string,
  isGoalie: boolean,
): Promise<GameRow[]> {
  return fetchAllRows<GameRow>(
    () =>
      supabase
        .from('player_game_stats')
        .select(GAME_COLUMNS)
        .eq('season', season)
        .eq('is_goalie', isGoalie)
        .gte('game_date', sinceDate),
    'player_game_stats query',
  );
}

// ── Detector 5: multi-point nights ───────────────────────────────────
// Calibrated on a real week (2026-01-05..11): 43 three-point games in seven
// days, ~6/day. Enough to keep a feed alive without burying it.
const bigGameDetector: Detector = {
  kind: 'big-game',
  label: 'Multi-point nights',
  phase: 'inseason',
  async run(supabase, season, now) {
    const directory = await loadDirectory(supabase, season);
    const rows = await fetchGamesSince(supabase, season, isoDaysAgo(now, EVENT_LOOKBACK_DAYS), false);

    const notes: GeneratedNote[] = [];
    for (const row of rows) {
      const points = Number(row.points);
      if (!Number.isFinite(points) || points < 3) continue;

      const person = directory.get(row.player_id);
      if (!person?.full_name) continue;

      const goals = Number(row.goals) || 0;
      const assists = (Number(row.primary_assists) || 0) + (Number(row.secondary_assists) || 0);
      const toiMin = Number(row.icetime_seconds) > 0 ? Number(row.icetime_seconds) / 60 : null;
      const surname = lastName(person.full_name);
      const hatTrick = goals >= 3;

      const line = [
        goals ? `${goals} goal${goals === 1 ? '' : 's'}` : null,
        assists ? `${assists} assist${assists === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' and ');

      notes.push({
        dedupeKey: `big-game:${season}:${row.player_id}:${row.game_id}`,
        kind: 'big-game',
        playerId: row.player_id,
        season,
        headline: hatTrick
          ? `${person.full_name} scored a hat trick`
          : `${person.full_name} put up ${points} points`,
        body:
          `${surname} recorded ${line} in ${weekdayName(row.game_date)}'s game` +
          `${row.shots_on_goal ? `, on ${row.shots_on_goal} shot${Number(row.shots_on_goal) === 1 ? '' : 's'} on goal` : ''}` +
          `${toiMin ? ` across ${fmt(toiMin)} minutes of ice time` : ''}.`,
        analysis:
          (goals > assists
            ? `${surname}'s night leaned on finishing: ${goals} of the ${points} points were goals. ` +
              (Number(row.shots_on_goal) > 0 ? `${row.shots_on_goal} shots supplied the recorded scoring opportunities. ` : '') +
              `Check whether the shot volume persists before expecting the same conversion again.`
            : goals === assists ? `${surname} split the ${points}-point return evenly between goals and assists. The balanced category contribution describes this game, not a new scoring rate.`
            : `${surname}'s ${assists} assists drove the playmaking return. That helps assists or points categories, but it does not establish a rise in his own goal or shot output.`),
        severity: 'positive',
        tags: hatTrick ? ['Hat trick', 'Big night'] : ['Multi-point', 'Big night'],
        publishedAt: gameDateToTimestamp(row.game_date),
      });
    }
    return notes;
  },
};

// ── Detector 6: goalie gems ──────────────────────────────────────────
// Shutouts (~1/day) and high-volume wins (~0.5/day) on the same calibration
// window. Both are the kind of start a manager wants surfaced.
const goalieGemDetector: Detector = {
  kind: 'goalie-gem',
  label: 'Goalie gems',
  phase: 'inseason',
  async run(supabase, season, now) {
    const directory = await loadDirectory(supabase, season);
    const rows = await fetchGamesSince(supabase, season, isoDaysAgo(now, EVENT_LOOKBACK_DAYS), true);

    const notes: GeneratedNote[] = [];
    for (const row of rows) {
      const saves = Number(row.saves) || 0;
      const shutout = (Number(row.shutouts) || 0) >= 1;
      const bigWorkloadWin = saves >= 35 && (Number(row.wins) || 0) >= 1;
      if (!shutout && !bigWorkloadWin) continue;

      const person = directory.get(row.player_id);
      if (!person?.full_name) continue;

      const shotsFaced = Number(row.shots_faced) || saves + (Number(row.goals_against) || 0);
      const surname = lastName(person.full_name);

      notes.push({
        dedupeKey: `goalie-gem:${season}:${row.player_id}:${row.game_id}`,
        kind: 'goalie-gem',
        playerId: row.player_id,
        season,
        headline: shutout
          ? `${person.full_name} posted a shutout`
          : `${person.full_name} made ${saves} saves in a win`,
        body: shutout
          ? `${surname} stopped all ${shotsFaced} shots he faced in ${weekdayName(row.game_date)}'s game.`
          : `${surname} turned aside ${saves} of ${shotsFaced} shots to win ${weekdayName(row.game_date)}'s game.`,
        analysis:
          (shutout
            ? `${surname} supplied a clean goals-against result${shotsFaced > 0 ? ` across ${shotsFaced} shots faced` : ''}; leagues that count shutouts received an additional category contribution. `
            : `${saves} saves supplied counting-stat volume along with the win. Facing ${shotsFaced} shots also meant substantial ratio exposure; a high shot count is not evidence of an easy matchup. `) +
          `This one game does not establish his share of future starts.`,
        severity: 'positive',
        tags: shutout ? ['Shutout', 'Goalie'] : ['Goalie', 'Workload'],
        publishedAt: gameDateToTimestamp(row.game_date),
      });
    }
    return notes;
  },
};

// ── Detector 7: point streaks ────────────────────────────────────────
// Published at milestones (5, 10, 15...) rather than every game. A streak that
// republished nightly would bury the feed under one player, and the dedupe key
// carries the milestone so an extension is genuinely new rather than a repeat.
const STREAK_MILESTONE_STEP = 5;

const pointStreakDetector: Detector = {
  kind: 'point-streak',
  label: 'Point streaks',
  phase: 'inseason',
  async run(supabase, season, now) {
    const directory = await loadDirectory(supabase, season);
    const rows = await fetchGamesSince(supabase, season, isoDaysAgo(now, STREAK_LOOKBACK_DAYS), false);

    // Newest game first, per player.
    const byPlayer = new Map<number, GameRow[]>();
    for (const row of rows) {
      const list = byPlayer.get(row.player_id);
      if (list) list.push(row);
      else byPlayer.set(row.player_id, [row]);
    }

    const notes: GeneratedNote[] = [];
    for (const [playerId, games] of byPlayer) {
      games.sort((a, b) => (a.game_date < b.game_date ? 1 : a.game_date > b.game_date ? -1 : 0));

      let streak = 0;
      let goals = 0;
      let assists = 0;
      let points = 0;
      for (const g of games) {
        if ((Number(g.points) || 0) <= 0) break;
        streak += 1;
        points += Number(g.points) || 0;
        goals += Number(g.goals) || 0;
        assists += (Number(g.primary_assists) || 0) + (Number(g.secondary_assists) || 0);
      }

      if (streak < STREAK_MILESTONE_STEP) continue;

      // Only publish AT a milestone, so a 7-game run stays the 5-game note
      // until it reaches 10 rather than emitting one every night.
      if (streak % STREAK_MILESTONE_STEP !== 0) continue;

      const person = directory.get(playerId);
      if (!person?.full_name) continue;

      const surname = lastName(person.full_name);
      const mostRecent = games[0];

      notes.push({
        dedupeKey: `point-streak:${season}:${playerId}:${streak}`,
        kind: 'point-streak',
        playerId,
        season,
        headline: `${person.full_name} has points in ${streak} straight games`,
        body:
          `${surname} has ${points} point${points === 1 ? '' : 's'} (${goals}G, ${assists}A) over the run, ` +
          `which is still active as of ${weekdayName(mostRecent.game_date)}'s game.`,
        analysis:
          (assists > goals
            ? `${assists} assists made playmaking the larger contribution during the run; a points streak alone does not establish goal-scoring or shot volume.`
            : `${goals} goals made finishing a central contribution during the run; sustained shot volume would be stronger support for future goals than the streak length alone.`) +
          ` The scoring record does not identify ${surname}'s linemates or confirm a lasting change in deployment.`,
        severity: 'positive',
        tags: ['Point streak', 'Hot hand'],
        publishedAt: gameDateToTimestamp(mostRecent.game_date),
      });
    }
    return notes;
  },
};


// Standing forecasts refresh in every phase from the governed index. Historical
// event detectors below retain their original insert-only publication semantics.
const seasonOutlookDetector: Detector = {
  kind: 'season-outlook', label: 'Season outlook', phase: 'always',
  run: (supabase, _season, now) => new PlayerOutlookService(supabase).generate(now),
};

export const DETECTORS: Detector[] = [
  // Offseason
  bounceBackDetector,
  regressionRiskDetector,
  usageSurgeDetector,
  goalieWorkloadDetector,
  seasonOutlookDetector,
  // In-season
  bigGameDetector,
  goalieGemDetector,
  pointStreakDetector,
];

/**
 * Are we in the offseason?
 *
 * getCurrentSeason() flips on the opener (see the shared season module), so
 * "the derived season is behind the calendar year" is exactly the offseason
 * window. Deliberately derived rather than a month range, because the 2026-27
 * season opens Sept 29 and any hard-coded "October" rule is wrong for it.
 */
export function isOffseason(now: Date = new Date()): boolean {
  const derived = getCurrentSeason();
  const byCalendar = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return derived === byCalendar && now.getMonth() < 9 && now.getMonth() >= 4;
}

export interface GenerationResult {
  season: number;
  phase: 'offseason' | 'inseason';
  ran: string[];
  skipped: string[];
  generated: number;
  inserted: number;
  outlookRefresh?: { inserted: number; updated: number; unchanged: number };
  outlookRetired?: number;
  errors: Array<{ kind: string; message: string }>;
}

/**
 * Run every detector relevant to the current phase and persist what they find.
 *
 * Idempotent: dedupe_key carries a UNIQUE constraint and inserts ignore
 * conflicts, so running this hourly republishes nothing. That matters because
 * a note's published_at is a claim about when we said something — rewriting it
 * on every run is the same dishonesty as the fabricated timestamps this engine
 * replaced.
 */
export async function generateCitrusNews(
  supabase: SupabaseClient,
  options: { season?: number; now?: Date } = {},
): Promise<GenerationResult> {
  const now = options.now ?? new Date();
  const season = options.season ?? getCurrentSeason();
  const offseason = isOffseason(now);
  const phase: 'offseason' | 'inseason' = offseason ? 'offseason' : 'inseason';

  const result: GenerationResult = {
    season,
    phase,
    ran: [],
    skipped: [],
    generated: 0,
    inserted: 0,
    errors: [],
  };

  const notes: GeneratedNote[] = [];

  for (const detector of DETECTORS) {
    if (detector.phase !== 'always' && detector.phase !== phase) {
      result.skipped.push(detector.kind);
      continue;
    }
    try {
      const found = await detector.run(supabase, season, now);
      notes.push(...found);
      result.ran.push(detector.kind);
    } catch (error) {
      // One detector failing must not lose the others' output.
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[citrus-news] detector ${detector.kind} failed:`, message);
      result.errors.push({ kind: detector.kind, message });
    }
  }

  result.generated = notes.length;
  if (notes.length === 0) return result;

  const outlooks = notes.filter(n => n.kind === 'season-outlook');
  if (outlooks.length) {
    try {
      result.outlookRefresh = await new PlayerOutlookService(supabase).persist(outlooks, now);
      result.outlookRetired = await new PlayerOutlookService(supabase).retireMissing(outlooks, now);
      result.inserted += result.outlookRefresh.inserted;
      logger.info('[citrus-news] outlook refresh', { ...result.outlookRefresh, retired: result.outlookRetired });
    } catch (error) {
      result.errors.push({ kind: 'outlook-persist', message: error instanceof Error ? error.message : String(error) });
    }
  }
  const rows = notes.filter(n => n.kind !== 'season-outlook').map((n) => ({
    dedupe_key: n.dedupeKey,
    kind: n.kind,
    player_id: n.playerId,
    season: n.season,
    headline: n.headline,
    body: n.body,
    analysis: n.analysis,
    severity: n.severity,
    tags: n.tags,
    // Only send published_at when a detector actually knows the moment;
    // otherwise let the column default to now().
    ...(n.publishedAt ? { published_at: n.publishedAt } : {}),
  }));

  // Chunked so a large first run doesn't hit a statement/payload limit.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('citrus_news')
      .upsert(chunk, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id');

    if (error) {
      logger.error('[citrus-news] insert chunk failed:', error.message);
      result.errors.push({ kind: 'persist', message: error.message });
      continue;
    }
    result.inserted += (data || []).length;
  }

  return result;
}
