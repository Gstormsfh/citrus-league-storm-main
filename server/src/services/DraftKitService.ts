import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentSeason, getProjectionsSeason, logger } from '@citrus/shared';
import { PlayerDashboardService, type DashboardIndexEntry } from './PlayerDashboardService';

/**
 * DraftKitService — the read-model behind /draft-kit, the paid analytics
 * section.
 *
 * WHAT WE TOOK FROM JFRESH HOCKEY, AND WHY
 * ----------------------------------------
 * The card grammar, not the assets and not the copy. Studied 2026-09-02 from
 * jfresh.substack.com's "Player Card Explainer" and "Player Card 2.0
 * Explainer". Four ideas are worth borrowing and are borrowed here:
 *
 *   1. EVERY METRIC IS A PERCENTILE, NOT A RATE. A reader cannot tell whether
 *      0.41 GAR/60 is good. "88th among forwards" needs no prior. JFresh's
 *      whole readability advantage is this one substitution.
 *   2. PERCENTILES ARE WITHIN POSITION, ALWAYS. His forwards are ranked
 *      against forwards and his defencemen against defencemen, because the
 *      distributions are not the same shape. Ours does the same and the rule
 *      is enforced in code (see cohortOf / percentileWithinCohort below).
 *   3. THE CARD DECOMPOSES ONE SUMMARY NUMBER INTO ITS PARTS. His is WAR into
 *      EV offence / EV defence / PP / PK / finishing / penalties. Ours is GAR
 *      into the components our own pipeline actually produces.
 *   4. GOALIES GET A DIFFERENT METRIC SET ENTIRELY, not skater metrics with
 *      blanks. His is GSAx-led; so is ours.
 *
 * What we did NOT take: his visual design, his colour ramp, his WAR model, his
 * thresholds, his prose, and his three-season weighting. The numbers on a
 * Citrus card come from Citrus tables and nowhere else, and each one below
 * names the column it came from.
 *
 * WHY THE PERCENTILES ARE COMPUTED HERE AND NOT IN THE BROWSER
 * -----------------------------------------------------------
 * The Players page computes its percentiles client-side, which is right for
 * that page: the whole payload is already there and the maths is free. It is
 * wrong here. A paywall whose premium numbers are derived in the browser is a
 * paywall that ships the premium numbers to everyone who opens devtools. The
 * gate has to sit in front of the data, so the cohort maths lives on this side
 * of it and the free path never assembles the paid object at all.
 *
 * REUSE
 * -----
 * The five-table player join is PlayerDashboardService's, not ours — this
 * service composes it rather than re-implementing it, so the Draft Kit and
 * the Players dashboard can never disagree about a player's GAR. We add only
 * what the kit needs on top: goalie GSAx, and prior-season team for the
 * roster-change view.
 */

// ── Cohorts ──────────────────────────────────────────────────────────

/**
 * The three comparison pools. This is the hard correctness rule of this
 * codebase in type form: a percentile is only ever taken inside one of these,
 * never across them.
 *
 * Concretely, why it matters: player_talent_metrics.xg_rating labels Cale
 * Makar "Below Avg" because it grades him against a pool that contains
 * forwards. He is a top-of-league defenceman. The kit therefore does not
 * render that column and computes its own cohort percentile instead.
 */
export type Cohort = 'F' | 'D' | 'G';

/**
 * position_code in player_directory is one of C / LW / RW / D / G, with a
 * handful of legacy single-letter L and R rows still present in the 2025
 * directory. Anything not D or G is a forward.
 */
export function cohortOf(positionCode: string | null | undefined, isGoalie?: boolean): Cohort {
  if (isGoalie) return 'G';
  const p = (positionCode ?? '').toUpperCase();
  if (p === 'G') return 'G';
  if (p === 'D') return 'D';
  return 'F';
}

export const COHORT_LABEL: Record<Cohort, string> = {
  F: 'forwards',
  D: 'defencemen',
  G: 'goalies',
};

// ── Tiers ────────────────────────────────────────────────────────────

export type DraftKitTier = 'free' | 'kit' | 'suite';

const TIER_RANK: Record<DraftKitTier, number> = { free: 0, kit: 1, suite: 2 };

export function tierAtLeast(held: DraftKitTier, required: DraftKitTier): boolean {
  return TIER_RANK[held] >= TIER_RANK[required];
}

/** How many players per cohort the unpaid preview shows. */
export const PREVIEW_CARDS_PER_COHORT = 5;

/** How many tiers a cohort's board is cut into. */
const TIER_COUNT = 8;

// ── Wire shapes ──────────────────────────────────────────────────────

/** One percentile row on a card. `value` is the raw number the percentile came from. */
export interface CardMetric {
  key: string;
  label: string;
  /** The source column, spelled out so a reader can audit any number on the card. */
  source: string;
  value: number | null;
  /** 0-100, computed inside the player's own cohort. Null when value is null. */
  percentile: number | null;
  /** How to render the raw value. */
  format: 'rate2' | 'rate3' | 'count1' | 'pct3';
}

export interface DraftKitCard {
  playerId: number;
  name: string;
  team: string;
  position: string;
  cohort: Cohort;
  jersey: number | null;
  headshotUrl: string | null;
  rosterStatus: string | null;
  /** Games played in the season the impact metrics describe. Drives low-sample styling. */
  sampleGames: number;
  /** Rank within cohort on projected fantasy points. 1 = highest. */
  cohortRank: number | null;
  /** Tier number within cohort, 1 = top tier. Null when unranked. */
  tier: number | null;
  /** Projected fantasy points for the projection season, from player_ros_projections. */
  projectedFantasyPoints: number | null;
  projectedFantasyPpg: number | null;
  projectedGames: number | null;
  /** Cohort percentile of projectedFantasyPoints. The card's headline number. */
  valuePercentile: number | null;
  /** Prior-season team when the player changed clubs between directories. */
  previousTeam: string | null;
  metrics: CardMetric[];
}

export interface RosterChange {
  playerId: number;
  name: string;
  position: string;
  cohort: Cohort;
  fromTeam: string;
  toTeam: string;
  projectedFantasyPoints: number | null;
  cohortRank: number | null;
}

export interface DraftKitBlurb {
  id: string;
  playerId: number | null;
  season: number;
  kind: string;
  title: string;
  body: string;
  authorName: string;
  authorRole: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishedAt: string;
}

export interface DraftKitBoard {
  tier: DraftKitTier;
  /** True when the caller is seeing a truncated board. */
  locked: boolean;
  /** Season the impact metrics describe (last completed season). */
  metricsSeason: number;
  /** Season the projections describe. */
  projectionSeason: number;
  cards: DraftKitCard[];
  /** Cohort sizes the percentiles were taken against. Shown on the card footer. */
  cohortSizes: Record<Cohort, number>;
  /** Total cards that exist behind the gate, so the preview can say what is missing. */
  totalCards: number;
  rosterChanges: RosterChange[];
  totalRosterChanges: number;
  blurbs: DraftKitBlurb[];
}

// ── Percentile maths ─────────────────────────────────────────────────

/**
 * Percentile of `val` inside `pool`: the share of the pool at or below it,
 * 0-100. Same definition the Players dashboard uses, deliberately — two
 * surfaces quoting different percentiles for the same player would be worse
 * than either definition being marginally better.
 *
 * `pool` must already be a single cohort. This function cannot check that for
 * you, which is why every caller in this file goes through the cohort maps
 * built in buildCards rather than assembling a pool by hand.
 */
export function percentileIn(pool: number[], val: number): number {
  if (pool.length === 0) return 0;
  let atOrBelow = 0;
  for (const x of pool) if (x <= val) atOrBelow += 1;
  return Math.round((100 * atOrBelow) / pool.length);
}

/**
 * Tier breaks by largest gap. Within an already-sorted-descending list of
 * projected point totals, the (count - 1) biggest drops between neighbours
 * become the tier boundaries.
 *
 * This is a transparent rule, not a model: no weighting, no judgement, and it
 * reproduces exactly from the numbers on screen. A draft board's tiers should
 * be arguable, and this one shows its argument.
 */
export function tierBreaks(sortedDesc: number[], count: number): number[] {
  if (sortedDesc.length <= 1 || count <= 1) return [];
  const gaps: Array<{ index: number; gap: number }> = [];
  for (let i = 1; i < sortedDesc.length; i++) {
    gaps.push({ index: i, gap: sortedDesc[i - 1] - sortedDesc[i] });
  }
  gaps.sort((a, b) => b.gap - a.gap || a.index - b.index);
  return gaps
    .slice(0, Math.min(count - 1, gaps.length))
    .map((g) => g.index)
    .sort((a, b) => a - b);
}

// ── Supporting reads ─────────────────────────────────────────────────

/**
 * PostgREST silently clamps an unbounded select to the project's max-rows and
 * returns 200 with a truncated body. The canonical write-up of how that bit
 * this codebase lives above selectAllPaged in PlayerDashboardService; the
 * short version is that a directory read came back half the league with the
 * stars missing and looked like a success. Page explicitly, and order by a
 * stable key so windows neither duplicate nor skip.
 *
 * These tables are small (~100 goalies, ~2k directory rows) but "small today"
 * is not a guarantee, and the failure mode is silent.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

async function selectSeasonPaged<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  season: number,
  orderKey: string,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('season', season)
      .order(orderKey, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return { data: out, error: null };
  }
  return {
    data: out,
    error: { message: `${table}: exceeded ${MAX_PAGES} pages while paging` },
  };
}

interface GoalieXgRow {
  goalie_id: number;
  gsax: number | null;
  xg_faced: number | null;
  shots_faced: number | null;
  goals_allowed: number | null;
}

interface DirectoryTeamRow {
  player_id: number;
  team_abbrev: string | null;
}

interface BlurbRow {
  id: string;
  player_id: number | null;
  season: number;
  kind: string;
  title: string;
  body: string;
  author_name: string;
  author_role: string | null;
  source_name: string | null;
  source_url: string | null;
  published_at: string;
}

// ── Service ──────────────────────────────────────────────────────────

export class DraftKitService {
  private dashboard: PlayerDashboardService;

  constructor(private supabase: SupabaseClient) {
    this.dashboard = new PlayerDashboardService(supabase);
  }

  /**
   * The caller's live tier.
   *
   * Takes NO user id. The client cannot name whose entitlement to read,
   * because this reads through the caller's own JWT and the RLS policy on
   * draft_kit_entitlements matches auth.uid() = user_id. A forged id in a
   * request body has nothing to attach to.
   *
   * Fails CLOSED: any error resolves to 'free'. An entitlement lookup that
   * errors open would hand the paid suite to everyone the moment the table
   * hiccups.
   */
  async getTier(): Promise<DraftKitTier> {
    const { data, error } = await this.supabase
      .from('draft_kit_entitlements')
      .select('tier, expires_at')
      .order('granted_at', { ascending: false })
      .limit(50);

    if (error) {
      logger.error('[draft-kit] entitlement read failed, denying access:', error.message);
      return 'free';
    }

    const now = Date.now();
    let best: DraftKitTier = 'free';
    for (const row of (data ?? []) as Array<{ tier: string; expires_at: string | null }>) {
      if (row.expires_at && new Date(row.expires_at).getTime() <= now) continue;
      const t = row.tier === 'suite' ? 'suite' : row.tier === 'kit' ? 'kit' : 'free';
      if (TIER_RANK[t] > TIER_RANK[best]) best = t;
    }
    return best;
  }

  /**
   * Build every card, with percentiles taken strictly inside each cohort.
   *
   * `goalieGsax` and `clubs` are passed in rather than fetched here so this
   * function stays pure and testable — the cohort rule is the thing worth
   * pinning in a test, and a function that also does IO is harder to pin.
   *
   * `clubs` carries the two directory answers for a player: the club he is on
   * for the season being projected, and the club he was on the season before.
   * The dashboard entry's own `team` is the METRICS season's club, which in
   * the offseason is last year's answer, so a kit for the upcoming season
   * must not render it as current.
   */
  buildCards(
    entries: DashboardIndexEntry[],
    goalieGsax: Map<number, GoalieXgRow>,
    clubs: Map<number, { current: string | null; previous: string | null }>,
  ): { cards: DraftKitCard[]; cohortSizes: Record<Cohort, number> } {
    // Partition FIRST. Everything downstream reads from these three buckets,
    // so there is no code path in which a forward's number can reach a
    // defenceman's pool.
    const byCohort: Record<Cohort, DashboardIndexEntry[]> = { F: [], D: [], G: [] };
    for (const e of entries) byCohort[cohortOf(e.position, e.is_goalie)].push(e);

    const cards: DraftKitCard[] = [];
    const cohortSizes: Record<Cohort, number> = { F: 0, D: 0, G: 0 };

    for (const cohort of ['F', 'D', 'G'] as Cohort[]) {
      const pool = byCohort[cohort];
      cohortSizes[cohort] = pool.length;
      if (pool.length === 0) continue;

      // One pool per metric, holding only the players who have that metric.
      // Ranking a player against a pool padded with zeros for absent values
      // would make "no sample" look like "bad", which is a different claim.
      const poolOf = (pick: (e: DashboardIndexEntry) => number | null): number[] =>
        pool.map(pick).filter((v): v is number => v != null && Number.isFinite(v));

      const valuePool = poolOf((e) => e.proj_fantasy_points);
      const garPool = poolOf((e) => e.gar_per_60);
      const evoPool = poolOf((e) => e.gar_evo);
      const evdPool = poolOf((e) => e.gar_evd);
      const ppoPool = poolOf((e) => e.gar_ppo);
      const ppdPool = poolOf((e) => e.gar_ppd);
      const penPool = poolOf((e) => e.gar_pen);
      const xgPool = poolOf((e) => e.xg_per_60);
      const finishingPool = poolOf((e) => (e.gp > 0 ? e.goals - e.x_goals : null));
      const gsaxPool = poolOf((e) => goalieGsax.get(e.id)?.gsax ?? null);
      const svPool = poolOf((e) => (e.gp > 0 && e.save_pct > 0 ? e.save_pct : null));
      const winPool = poolOf((e) => (e.gp > 0 ? e.wins : null));

      // Rank + tier on projected fantasy points, descending.
      const ranked = pool
        .filter((e) => e.proj_fantasy_points != null)
        .sort((a, b) => (b.proj_fantasy_points ?? 0) - (a.proj_fantasy_points ?? 0));
      const rankById = new Map<number, number>();
      ranked.forEach((e, i) => rankById.set(e.id, i + 1));

      const breaks = tierBreaks(
        ranked.map((e) => e.proj_fantasy_points as number),
        TIER_COUNT,
      );
      const tierById = new Map<number, number>();
      let tierNo = 1;
      let breakCursor = 0;
      ranked.forEach((e, i) => {
        while (breakCursor < breaks.length && breaks[breakCursor] === i) {
          tierNo += 1;
          breakCursor += 1;
        }
        tierById.set(e.id, tierNo);
      });

      for (const e of pool) {
        const pctOf = (poolArr: number[], v: number | null | undefined): number | null =>
          v == null || !Number.isFinite(v) ? null : percentileIn(poolArr, v);

        const metrics: CardMetric[] =
          cohort === 'G'
            ? goalieMetrics(e, goalieGsax.get(e.id), { gsaxPool, svPool, winPool }, pctOf)
            : skaterMetrics(
                e,
                { garPool, evoPool, evdPool, ppoPool, ppdPool, penPool, xgPool, finishingPool },
                pctOf,
              );

        // The club for the season being projected, falling back to the
        // metrics-season club for a player who is not in the newer directory
        // (a UFA, or someone the pipeline has not re-seeded yet). A previous
        // club is only claimed when both answers exist and differ; a missing
        // row is not evidence of a move.
        const club = clubs.get(e.id);
        const team = club?.current ?? e.team;
        const previousTeam =
          club?.previous && club.previous !== team ? club.previous : null;

        cards.push({
          playerId: e.id,
          name: e.name,
          team,
          position: e.position,
          cohort,
          jersey: e.jersey,
          headshotUrl: e.headshot_url,
          rosterStatus: e.roster_status,
          sampleGames: e.gp,
          cohortRank: rankById.get(e.id) ?? null,
          tier: tierById.get(e.id) ?? null,
          projectedFantasyPoints: e.proj_fantasy_points,
          projectedFantasyPpg: e.proj_fantasy_ppg,
          projectedGames: e.proj_gp,
          valuePercentile: pctOf(valuePool, e.proj_fantasy_points),
          previousTeam,
          metrics,
        });
      }
    }

    cards.sort(
      (a, b) => (b.projectedFantasyPoints ?? -Infinity) - (a.projectedFantasyPoints ?? -Infinity),
    );
    return { cards, cohortSizes };
  }

  /**
   * The whole section payload for one caller, shaped by their tier.
   *
   * The gate is here, at assembly. An unentitled caller gets an object that
   * was never populated with the paid rows, so there is nothing in the
   * response for a client to un-hide.
   */
  async getBoard(): Promise<{ board: DraftKitBoard | null; error: Error | null }> {
    const tier = await this.getTier();
    const metricsSeason = getCurrentSeason();
    const projectionSeason = getProjectionsSeason();
    const entitled = tierAtLeast(tier, 'kit');

    const { players, error } = await this.dashboard.getDashboardIndex();
    if (error) return { board: null, error };

    // Who is on which club, for the season being projected and the one before
    // it. Anchored to projectionSeason on BOTH sides rather than to
    // getCurrentSeason(), because those two keys are the same number in season
    // and one apart in the offseason: pairing metricsSeason with
    // projectionSeason would compare 2025 with 2025 today and find that nobody
    // in the league had moved.
    //
    // player_directory has a prior_team column that would have been the
    // obvious source for this. It is NULL on every row in prod (checked
    // 2026-09-02), so comparing two directory seasons is the honest
    // derivation available.
    const [goalieRes, currentDirRes, priorDirRes] = await Promise.all([
      selectSeasonPaged<GoalieXgRow>(
        this.supabase,
        'goalie_xg_season',
        'goalie_id, gsax, xg_faced, shots_faced, goals_allowed',
        metricsSeason,
        'goalie_id',
      ),
      selectSeasonPaged<DirectoryTeamRow>(
        this.supabase,
        'player_directory',
        'player_id, team_abbrev',
        projectionSeason,
        'player_id',
      ),
      selectSeasonPaged<DirectoryTeamRow>(
        this.supabase,
        'player_directory',
        'player_id, team_abbrev',
        projectionSeason - 1,
        'player_id',
      ),
    ]);

    if (goalieRes.error) return { board: null, error: new Error(goalieRes.error.message) };
    if (currentDirRes.error) return { board: null, error: new Error(currentDirRes.error.message) };
    if (priorDirRes.error) return { board: null, error: new Error(priorDirRes.error.message) };

    const goalieGsax = new Map<number, GoalieXgRow>();
    for (const g of goalieRes.data) {
      // goalie_xg_season carries a 'regular' and a 'playoff' row per goalie per
      // season. The kit reports regular season, and the column list above does
      // not include game_type, so filter by taking the larger shots_faced row
      // per goalie — the regular-season row, by an order of magnitude.
      const prior = goalieGsax.get(g.goalie_id);
      if (!prior || (g.shots_faced ?? 0) > (prior.shots_faced ?? 0)) goalieGsax.set(g.goalie_id, g);
    }

    const clubs = new Map<number, { current: string | null; previous: string | null }>();
    for (const d of currentDirRes.data) {
      clubs.set(d.player_id, { current: d.team_abbrev ?? null, previous: null });
    }
    for (const d of priorDirRes.data) {
      const entry = clubs.get(d.player_id);
      if (entry) entry.previous = d.team_abbrev ?? null;
      else clubs.set(d.player_id, { current: null, previous: d.team_abbrev ?? null });
    }

    const { cards, cohortSizes } = this.buildCards(players, goalieGsax, clubs);

    const allRosterChanges: RosterChange[] = cards
      .filter((c) => c.previousTeam)
      .map((c) => ({
        playerId: c.playerId,
        name: c.name,
        position: c.position,
        cohort: c.cohort,
        fromTeam: c.previousTeam as string,
        toTeam: c.team,
        projectedFantasyPoints: c.projectedFantasyPoints,
        cohortRank: c.cohortRank,
      }))
      .sort(
        (a, b) =>
          (b.projectedFantasyPoints ?? -Infinity) - (a.projectedFantasyPoints ?? -Infinity),
      );

    const blurbs = await this.getBlurbs(projectionSeason, tier);

    if (entitled) {
      return {
        board: {
          tier,
          locked: false,
          metricsSeason,
          projectionSeason,
          cards,
          cohortSizes,
          totalCards: cards.length,
          rosterChanges: allRosterChanges,
          totalRosterChanges: allRosterChanges.length,
          blurbs,
        },
        error: null,
      };
    }

    // ── The free path ──
    // Build a SEPARATE, smaller object. The paid cards above are not filtered
    // down or flagged hidden, they are simply not part of what is returned:
    // the preview card keeps identity, rank and tier so the board reads as a
    // real board, and drops every percentile and every projection number,
    // which is what is being sold.
    const previewIds = new Set<number>();
    for (const cohort of ['F', 'D', 'G'] as Cohort[]) {
      cards
        .filter((c) => c.cohort === cohort && c.cohortRank != null)
        .slice(0, PREVIEW_CARDS_PER_COHORT)
        .forEach((c) => previewIds.add(c.playerId));
    }

    const previewCards: DraftKitCard[] = cards
      .filter((c) => previewIds.has(c.playerId))
      .map((c) => ({
        ...c,
        projectedFantasyPoints: null,
        projectedFantasyPpg: null,
        projectedGames: null,
        valuePercentile: null,
        metrics: [],
      }));

    return {
      board: {
        tier,
        locked: true,
        metricsSeason,
        projectionSeason,
        cards: previewCards,
        cohortSizes,
        totalCards: cards.length,
        rosterChanges: [],
        totalRosterChanges: allRosterChanges.length,
        blurbs,
      },
      error: null,
    };
  }

  /**
   * Published blurbs for a season, filtered to what this tier may read.
   *
   * Belt and braces: the RLS policy on draft_kit_blurbs already refuses paid
   * rows to an unentitled caller, and this filter refuses them again here. The
   * database is the enforcement; this is the part a reviewer can see.
   */
  async getBlurbs(season: number, tier: DraftKitTier): Promise<DraftKitBlurb[]> {
    const readable: string[] = tierAtLeast(tier, 'suite')
      ? ['free', 'kit', 'suite']
      : tierAtLeast(tier, 'kit')
        ? ['free', 'kit']
        : ['free'];

    const { data, error } = await this.supabase
      .from('draft_kit_blurbs')
      .select(
        'id, player_id, season, kind, title, body, author_name, author_role, source_name, source_url, published_at',
      )
      .eq('season', season)
      .eq('is_published', true)
      .in('tier_required', readable)
      .order('published_at', { ascending: false })
      .limit(200);

    if (error) {
      // A missing blurb block is not a reason to fail the whole section.
      logger.error('[draft-kit] blurb read failed:', error.message);
      return [];
    }

    return ((data ?? []) as BlurbRow[]).map((b) => ({
      id: b.id,
      playerId: b.player_id,
      season: b.season,
      kind: b.kind,
      title: b.title,
      body: b.body,
      authorName: b.author_name,
      authorRole: b.author_role,
      sourceName: b.source_name,
      sourceUrl: b.source_url,
      publishedAt: b.published_at,
    }));
  }
}

type PctFn = (pool: number[], v: number | null | undefined) => number | null;

/**
 * Skater rows. Every `source` string below names a real column; if a metric
 * cannot name one it does not belong on the card.
 *
 * The GAR decomposition mirrors JFresh's WAR decomposition in structure. It is
 * NOT his model: these are our pipeline's GAR components, written by the
 * gar_components_in_sql migration and read through PlayerDashboardService.
 */
function skaterMetrics(
  e: DashboardIndexEntry,
  pools: {
    garPool: number[];
    evoPool: number[];
    evdPool: number[];
    ppoPool: number[];
    ppdPool: number[];
    penPool: number[];
    xgPool: number[];
    finishingPool: number[];
  },
  pct: PctFn,
): CardMetric[] {
  const finishing = e.gp > 0 ? e.goals - e.x_goals : null;
  return [
    {
      key: 'gar60',
      label: 'Total impact',
      source: 'player_gar_components.total_gar_per_60',
      value: e.gar_per_60,
      percentile: pct(pools.garPool, e.gar_per_60),
      format: 'rate2',
    },
    {
      key: 'evo',
      label: 'Even strength offence',
      source: 'player_gar_components.evo_gar_per_60',
      value: e.gar_evo,
      percentile: pct(pools.evoPool, e.gar_evo),
      format: 'rate2',
    },
    {
      key: 'evd',
      label: 'Even strength defence',
      source: 'player_gar_components.evd_gar_per_60',
      value: e.gar_evd,
      percentile: pct(pools.evdPool, e.gar_evd),
      format: 'rate2',
    },
    {
      key: 'ppo',
      label: 'Power play offence',
      source: 'player_gar_components.ppo_gar_per_60',
      value: e.gar_ppo,
      percentile: pct(pools.ppoPool, e.gar_ppo),
      format: 'rate2',
    },
    {
      key: 'ppd',
      // The PK component. gar_ppd is defensive value on special teams, and it
      // tracks shorthanded ice time: of the 780 skaters with a 2025 row, 777
      // have PK minutes and nobody with zero PK minutes carries a non-zero
      // value (checked 2026-09-02). A skater who never kills penalties
      // therefore sits at zero, which is the honest reading of his PK
      // contribution rather than a missing one.
      label: 'Penalty kill',
      source: 'player_gar_components.ppd_gar_per_60',
      value: e.gar_ppd,
      percentile: pct(pools.ppdPool, e.gar_ppd),
      format: 'rate2',
    },
    {
      key: 'pen',
      label: 'Penalty differential',
      source: 'player_gar_components.penalty_gar_per_60',
      value: e.gar_pen,
      percentile: pct(pools.penPool, e.gar_pen),
      format: 'rate2',
    },
    {
      key: 'xg60',
      label: 'Shot quality',
      source: 'player_talent_metrics.xg_per_60',
      value: e.xg_per_60,
      percentile: pct(pools.xgPool, e.xg_per_60),
      format: 'rate2',
    },
    {
      key: 'finishing',
      label: 'Finishing',
      // Goals minus expected goals for the same season, both from
      // player_season_stats. Positive = scored more than the shots implied.
      source: 'player_season_stats.nhl_goals - player_season_stats.x_goals',
      value: finishing,
      percentile: pct(pools.finishingPool, finishing),
      format: 'count1',
    },
  ];
}

/**
 * Goalie rows. A different metric set, not a skater card with holes — the same
 * choice JFresh makes and for the same reason: none of the skater components
 * are defined for a goaltender.
 */
function goalieMetrics(
  e: DashboardIndexEntry,
  gx: GoalieXgRow | undefined,
  pools: { gsaxPool: number[]; svPool: number[]; winPool: number[] },
  pct: PctFn,
): CardMetric[] {
  const savePct = e.gp > 0 && e.save_pct > 0 ? e.save_pct : null;
  const wins = e.gp > 0 ? e.wins : null;
  return [
    {
      key: 'gsax',
      label: 'Goals saved above expected',
      source: 'goalie_xg_season.gsax',
      value: gx?.gsax ?? null,
      percentile: pct(pools.gsaxPool, gx?.gsax ?? null),
      format: 'count1',
    },
    {
      key: 'xg_faced',
      label: 'Expected goals faced',
      source: 'goalie_xg_season.xg_faced',
      value: gx?.xg_faced ?? null,
      // Workload, not quality — a percentile here would read as a rating of
      // something that is mostly the team in front of him, so it stays raw.
      percentile: null,
      format: 'count1',
    },
    {
      key: 'save_pct',
      label: 'Save percentage',
      source: 'player_season_stats.nhl_save_pct',
      value: savePct,
      percentile: pct(pools.svPool, savePct),
      format: 'pct3',
    },
    {
      key: 'wins',
      label: 'Wins',
      source: 'player_season_stats.nhl_wins',
      value: wins,
      percentile: pct(pools.winPool, wins),
      format: 'count1',
    },
  ];
}
