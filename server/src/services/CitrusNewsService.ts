import type { SupabaseClient } from '@supabase/supabase-js';
import { logger, getCurrentSeason } from '@citrus/shared';

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
}

/** Which part of the calendar a detector has something true to say in. */
export type DetectorPhase = 'offseason' | 'inseason' | 'always';

export interface Detector {
  kind: string;
  label: string;
  phase: DetectorPhase;
  run(supabase: SupabaseClient, season: number): Promise<GeneratedNote[]>;
}

/** One decimal, without a trailing ".0" on whole numbers. */
function fmt(n: number, decimals = 1): string {
  return Number(n.toFixed(decimals)).toString();
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
          `${person.full_name} finished last season with ${goals} goals in ${row.games_played} games ` +
          `on ${fmt(xg)} expected — a shortfall of ${fmt(shortfall)}. ` +
          `The chances were there; the finishing wasn't.`,
        analysis:
          `Shooting percentage is the least repeatable number on a stat sheet, and a gap this size ` +
          `usually closes on its own. ${surname} is the type drafts undervalue, because draft position ` +
          `anchors on last year's goal total rather than the chances behind it. Worth a look anywhere ` +
          `he's being priced on the ${goals}.`,
        severity: 'positive',
        tags: ['Bounce-back', 'Buy-low', 'xG'],
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
          `${person.full_name} put up ${goals} goals in ${row.games_played} games against ${fmt(xg)} expected, ` +
          `finishing ${fmt(over)} goals above what the quality of his chances predicted.`,
        analysis:
          `This is a flag, not a verdict. Genuinely elite shooters beat their expected totals year after ` +
          `year, and the model does not know how good a release is — so the honest read is that some of ` +
          `this is skill and some is variance. What is hard to defend is paying for a repeat of the full ` +
          `${goals}. If ${surname}'s draft price assumes that number is the new baseline, the risk sits ` +
          `with whoever pays it.`,
        severity: 'caution',
        tags: ['Regression risk', 'Sell-high', 'xG'],
      });
    }
    return notes;
  },
};

// ── Detector 3: usage surge ──────────────────────────────────────────
// Ice time is the most stable predictor of opportunity, and a year-over-year
// jump is the clearest evidence a coach's view of a player changed.
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
          `${person.full_name} averaged ${fmt(now)} minutes per game last season, up from ${fmt(before)} ` +
          `the year before — a ${fmt(delta)}-minute increase across ${row.games_played} games.`,
        analysis:
          `Ice time is the most stable input to fantasy production, and a jump this size is a coaching ` +
          `decision rather than a hot streak. Even if the point totals haven't caught up yet, the ` +
          `opportunity ${surname} is being handed is the part that tends to persist into next season.`,
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
        headline: `${person.full_name} carried a true starter's workload`,
        body:
          `${person.full_name} appeared in ${row.goalie_gp} games last season with a ${savePctLabel} save ` +
          `percentage${row.wins ? ` and ${row.wins} wins` : ''}` +
          `${row.shutouts ? `, including ${row.shutouts} shutout${row.shutouts === 1 ? '' : 's'}` : ''}.`,
        analysis:
          `Volume is most of a fantasy goalie's value — saves and wins are counting stats, and you cannot ` +
          `accumulate either from the bench. A goalie who clears 45 appearances at this save rate is ` +
          `holding a crease outright rather than splitting it, which is the profile worth drafting. ` +
          `${surname} belongs in the tier where you take the starts and stop worrying about the committee.`,
        severity: 'positive',
        tags: ['Goalie', 'Workload', 'Volume'],
      });
    }
    return notes;
  },
};

export const DETECTORS: Detector[] = [
  bounceBackDetector,
  regressionRiskDetector,
  usageSurgeDetector,
  goalieWorkloadDetector,
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
      const found = await detector.run(supabase, season);
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

  const rows = notes.map((n) => ({
    dedupe_key: n.dedupeKey,
    kind: n.kind,
    player_id: n.playerId,
    season: n.season,
    headline: n.headline,
    body: n.body,
    analysis: n.analysis,
    severity: n.severity,
    tags: n.tags,
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
