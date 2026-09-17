/**
 * One tap from a league on Yahoo or ESPN to a league on Citrus.
 *
 * The commissioner picks their league at the source and gets back a Citrus
 * league that already carries its name, format, scoring weights or
 * categories, roster slots, draft type, playoff shape, keeper rule and team
 * count, with the whole history import already running behind it. Nothing
 * to create first, nothing to confirm before the trophy room fills.
 *
 * Two halves, kept apart on purpose:
 *   * `foundingPlan` is pure. The newest season's settings, as the source
 *     stated them, become the arguments LeagueService.createLeague takes.
 *     Whatever Citrus cannot express is named in `notes`, never dropped
 *     silently; the commissioner sees the notes on the import screen and the
 *     same settings stay on the trophy room's confirm panel for later edits.
 *   * The service reads one settings payload from the source, creates the
 *     league through LeagueService (the same path Create League uses, so the
 *     commissioner's team, join code and defaults are all there), then starts
 *     the ordinary background import on it.
 *
 * Every decision here is reversible in league settings before the draft; a
 * founded league is an ordinary league with `settings.foundedFrom` stamped.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDefaultSettings, DEFAULT_ROSTER_SLOTS, AVAILABLE_CATEGORIES, type ScoringFormat } from '@citrus/shared';
import type { ImportedSettings, ImportPlatform } from '../../import/types';
import { EspnClient, ESPN_VIEWS, type EspnCredentials } from '../../import/espn/client';
import { parseEspnSeason } from '../../import/espn/parse';
import { citrusSeasonToEspn } from '../../import/espn/maps';
import type { YahooClient } from '../../import/yahoo/client';
import { parseYahooSeason } from '../../import/yahoo/parse';
import { LeagueService } from '../LeagueService';
import { ScoringTranslationService, type TranslatedScoring } from './ScoringTranslationService';
import { LeagueImportService, currentCitrusSeason, type ImportJobRow } from './LeagueImportService';

/** Citrus scoring key -> Citrus category id; the same table the web confirm screen uses. */
export const CATEGORY_ID_BY_KEY: Record<string, string> = {
  goals: 'goals', assists: 'assists', points: 'points', plus_minus: 'plus_minus',
  power_play_points: 'ppp', short_handed_points: 'shp', shots_on_goal: 'sog', hits: 'hits', blocks: 'blocks', penalty_minutes: 'pim',
  wins: 'wins', saves: 'saves', shutouts: 'shutouts', goals_against_average: 'gaa', save_percentage: 'save_pct',
};

const CITRUS_SLOTS = new Set(DEFAULT_ROSTER_SLOTS.map((s) => s.slot));
const KNOWN_CATEGORY_IDS = new Set(AVAILABLE_CATEGORIES.map((c) => c.id));

export interface FoundingPlan {
  name: string;
  scoringFormat: ScoringFormat;
  /** Point weights for a points league; null means Citrus defaults. */
  scoringSettings: { skater: Record<string, number>; goalie: Record<string, number> } | null;
  /** Category ids for a category league; null for a points league. */
  categories: string[] | null;
  rosterSlots: Record<string, number>;
  rosterSize: number;
  draftRounds: number;
  draftType: 'snake' | 'auction';
  teamsCount: number;
  playoffTeams: number | null;
  playoffWeeks: number | null;
  keeper: { enabled: boolean; count: number };
  /** What could not be carried over, in plain words for the commissioner. */
  notes: string[];
  translated: TranslatedScoring;
}

export interface FoundedLeague {
  league: { id: string; name: string; join_code: string | null };
  job: ImportJobRow;
  plan: Omit<FoundingPlan, 'translated'>;
}

function slotOf(source: string): string {
  const s = source.toUpperCase();
  if (s === 'F' || s === 'W' || s === 'UTIL' || s === 'FLEX') return 'UTIL';
  if (s === 'BENCH') return 'BN';
  if (s === 'IR+' || s === 'IL' || s === 'IL+') return 'IR';
  return s;
}

/** The newest season's settings, as the source stated them, as a Citrus league. Pure. */
export function foundingPlan(settings: ImportedSettings, teamCount: number | null, translator = new ScoringTranslationService()): FoundingPlan {
  const t = translator.translate(settings);
  const notes: string[] = [];
  const defaults = getDefaultSettings('fantasy');

  let scoringFormat: ScoringFormat = t.scoringFormat ?? 'h2h-points';
  if (!t.scoringFormat) notes.push('The source did not say how the league scores; it starts as head-to-head points. Change it in league settings before the draft.');
  const isCategories = scoringFormat === 'h2h-categories' || scoringFormat === 'roto';

  let scoringSettings: FoundingPlan['scoringSettings'] = null;
  let categories: string[] | null = null;
  if (isCategories) {
    const ids: string[] = [];
    const unsupported: string[] = [];
    for (const key of t.categories) {
      const id = CATEGORY_ID_BY_KEY[key];
      if (id && KNOWN_CATEGORY_IDS.has(id)) { if (!ids.includes(id)) ids.push(id); } else unsupported.push(key);
    }
    if (unsupported.length) notes.push(`Categories Citrus does not score were left out: ${unsupported.map((k) => k.replace(/_/g, ' ')).join(', ')}.`);
    if (ids.length >= 2) {
      categories = ids;
    } else {
      categories = [...defaults.categories];
      notes.push('Fewer than two of the source categories are ones Citrus scores; the league starts with the standard set. Edit them in league settings.');
    }
  } else {
    const hasWeights = Object.keys(t.scoringSettings.skater).length + Object.keys(t.scoringSettings.goalie).length > 0;
    if (hasWeights) scoringSettings = { skater: { ...t.scoringSettings.skater }, goalie: { ...t.scoringSettings.goalie } };
    else notes.push('The source gave no point values; the league starts on Citrus standard scoring.');
  }
  for (const u of t.unmapped) {
    notes.push(`${u.citrusKey.startsWith('unknown_') ? `Stat "${u.sourceStatId}"` : u.citrusKey.replace(/_/g, ' ')}: ${u.reason.toLowerCase()}.`);
  }

  const rosterSlots: Record<string, number> = {};
  const droppedSlots: string[] = [];
  let converted = false;
  for (const r of t.rosterSlots) {
    if (r.count <= 0) continue;
    const slot = slotOf(r.slot);
    if (slot !== r.slot.toUpperCase() && slot === 'UTIL') converted = true;
    if (CITRUS_SLOTS.has(slot)) rosterSlots[slot] = (rosterSlots[slot] ?? 0) + r.count;
    else droppedSlots.push(`${r.slot} x${r.count}`);
  }
  if (converted) notes.push('Forward and wing slots became utility slots; Citrus fills them with any skater.');
  if (droppedSlots.length) notes.push(`Roster spots Citrus does not have were left out: ${droppedSlots.join(', ')}.`);
  const usingDefaultRoster = Object.keys(rosterSlots).length === 0;
  if (usingDefaultRoster) {
    for (const s of DEFAULT_ROSTER_SLOTS) rosterSlots[s.slot] = s.count;
    notes.push('The source gave no roster shape; the league starts on the standard Citrus roster.');
  }
  const activeSlots = Object.entries(rosterSlots).filter(([k]) => k !== 'IR').reduce((n, [, c]) => n + c, 0);
  const rosterSize = Math.max(1, activeSlots);
  const draftRounds = rosterSize;

  const draftType: FoundingPlan['draftType'] = /auction/i.test(t.draftType ?? '') ? 'auction' : 'snake';
  const teamsCount = teamCount && teamCount >= 2 ? teamCount : defaults.teamsCount;
  if (!(teamCount && teamCount >= 2)) notes.push(`The source did not say how many teams; the league starts at ${defaults.teamsCount}.`);

  const keeperCount = t.keeper.count ?? 0;
  if (keeperCount > 0) notes.push(`Keepers: ${keeperCount} per team, at draft-round cost until you confirm the rule in league settings. The source does not state keeper cost rules.`);

  return {
    name: settings.leagueName?.trim() || 'My league',
    scoringFormat,
    scoringSettings,
    categories,
    rosterSlots,
    rosterSize,
    draftRounds,
    draftType,
    teamsCount,
    playoffTeams: t.playoffs.teamCount,
    playoffWeeks: t.playoffs.weeks,
    keeper: { enabled: keeperCount > 0, count: keeperCount },
    notes,
    translated: t,
  };
}

export class LeagueFoundingService {
  private readonly leagues: LeagueService;
  private readonly imports: LeagueImportService;

  constructor(
    private readonly supabase: SupabaseClient,
    admin: SupabaseClient,
    deps: { leagues?: LeagueService; imports?: LeagueImportService } = {},
  ) {
    this.leagues = deps.leagues ?? new LeagueService(supabase);
    this.imports = deps.imports ?? new LeagueImportService(supabase, admin);
  }

  /** Read the newest Yahoo season's settings, found the league on them, start the import. */
  async foundFromYahoo(opts: { leagueKey: string; userId: string; client: YahooClient; importerGuid?: string | null }): Promise<FoundedLeague> {
    const bundle = await opts.client.league(opts.leagueKey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const league: any = (bundle.content as any)?.league;
    if (!league) throw new Error('Yahoo returned no league for that key.');
    const parsed = parseYahooSeason({ league });
    const plan = foundingPlan(parsed.settings, parsed.teams.length || null);
    const created = await this.createLeague(plan, opts.userId, 'yahoo', parsed.externalLeagueId);
    const job = await this.imports.startYahoo({ leagueId: created.id, leagueKey: opts.leagueKey, requestedBy: opts.userId, client: opts.client, importerGuid: opts.importerGuid ?? null });
    return { league: created, job, plan: withoutTranslation(plan) };
  }

  /** Read the newest ESPN season's core view, found the league on it, start the import. */
  async foundFromEspn(opts: { externalLeagueId: string; userId: string; client: EspnClient; creds?: EspnCredentials; latestEspnSeason?: number; importerSwid?: string | null }): Promise<FoundedLeague> {
    const espnSeason = opts.latestEspnSeason ?? citrusSeasonToEspn(currentCitrusSeason());
    const core = await opts.client.fetchSeason(opts.externalLeagueId, espnSeason, [...ESPN_VIEWS.core], opts.creds);
    const parsed = parseEspnSeason(opts.externalLeagueId, { core: core.body });
    const plan = foundingPlan(parsed.settings, parsed.teams.length || null);
    const created = await this.createLeague(plan, opts.userId, 'espn', opts.externalLeagueId);
    const job = await this.imports.startEspn({
      leagueId: created.id, externalLeagueId: opts.externalLeagueId, requestedBy: opts.userId, client: opts.client,
      creds: opts.creds, importerSwid: opts.importerSwid ?? null, latestEspnSeason: opts.latestEspnSeason,
    });
    return { league: created, job, plan: withoutTranslation(plan) };
  }

  /** The league, through the same path Create League uses, with the plan applied. */
  async createLeague(plan: FoundingPlan, userId: string, platform: ImportPlatform, externalLeagueId: string): Promise<FoundedLeague['league']> {
    const defaults = getDefaultSettings('fantasy');
    const settings: Record<string, unknown> = {
      ...defaults,
      scoringFormat: plan.scoringFormat,
      draftType: plan.draftType,
      teamsCount: plan.teamsCount,
      draftRounds: plan.draftRounds,
      playoffTeams: plan.playoffTeams ?? defaults.playoffTeams,
      playoffWeeks: plan.playoffWeeks ?? defaults.playoffWeeks,
      keeperEnabled: plan.keeper.enabled,
      keeperCount: plan.keeper.count,
      keeperPenalty: plan.keeper.enabled ? 'round-cost' : 'none',
      dynastyMode: false,
      categories: plan.categories ?? defaults.categories,
      rosterSlots: plan.rosterSlots,
      foundedFrom: { platform, externalLeagueId, at: new Date().toISOString(), notes: plan.notes },
    };
    // createLeague types scoring as flat weights but stores the {skater, goalie} shape ScoringCalculator reads (its own default is that shape).
    const scoring = plan.scoringSettings ? (plan.scoringSettings as unknown as Record<string, number>) : undefined;
    const { league, error } = await this.leagues.createLeague(plan.name, userId, plan.rosterSize, plan.draftRounds, settings, scoring);
    if (error || !league) throw new Error(`Could not create the league: ${(error as { message?: string } | null)?.message ?? 'unknown error'}`);
    const row = league as { id: string; name: string; join_code?: string | null };
    const { error: uErr } = await this.supabase.from('leagues').update({ imported_from: platform }).eq('id', row.id);
    if (uErr) throw new Error(`leagues update failed: ${uErr.message}`);
    return { id: row.id, name: row.name, join_code: row.join_code ?? null };
  }
}

function withoutTranslation(plan: FoundingPlan): Omit<FoundingPlan, 'translated'> {
  const { translated: _t, ...rest } = plan; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}
