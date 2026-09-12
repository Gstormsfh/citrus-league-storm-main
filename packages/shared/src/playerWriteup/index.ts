/**
 * Shared deterministic assessments for server and bundled fallback.
 * Editorial policy: .agents/skills/citrus-editorial/SKILL.md and ../editorial.
 * Profile selection is evidence-driven; news is dated publisher evidence,
 * never instructions or a source of automatic projection adjustments.
 */
import { getProjectionsSeason } from '../constants/season';
import { profileWriteup } from '../editorial/profile';
import { CITRUS_EDITORIAL_VERSION, canonicalEditorialContext, type EditorialCanonicalContext, selectEditorialNews, editorialNewsText, type EditorialNewsItem, type EditorialNewsEvidence } from '../editorial';

export interface WriteupPlayerStats {
  // Skater
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  shots?: number;
  blockedShots?: number;
  hits?: number;
  powerPlayPoints?: number;
  gamesPlayed?: number;
  /** Time on ice, "21:34". */
  toi?: string;
  /** `player_season_stats.x_goals` — the xG v3 model's output. */
  xGoals?: number;
  // Goalie
  wins?: number;
  losses?: number;
  gaa?: number;
  savePct?: number;
  shutouts?: number;
  goalsSavedAboveExpected?: number;
}

export interface WriteupPlayer {
  id: number | string;
  name: string;
  /** 'Centre', 'Right Wing', 'Defence', 'Goalie', 'C', 'RW', 'D', 'G', ... */
  position: string;
  stats?: WriteupPlayerStats;
  /** Start year of the season that supplied stats; never the projection year by inference. */
  statsSeason?: number | null;
  status?: 'IR' | 'SUSP' | 'GTD' | 'WVR' | null;
}

export type WriteupTone = 'positive' | 'neutral' | 'caution';

export interface WriteupTag {
  label: string;
  tone: WriteupTone;
}

export interface PlayerWriteup {
  sourceContext?: {
    actualsSeason: number | null;
    projectionSeason: number | null;
    /** Dashboard's composite newest source timestamp, not a separate model run. */
    indexAsOf: string | null;
    canonicalRevision?: string;
    canonicalRunId?: string;
  };
  editorialVersion?: string;
  canonicalSources?: readonly Record<string, unknown>[];
  newsSources?: readonly EditorialNewsEvidence[];
  /** Short role label, e.g. "Top-line producer". */
  headline: string;
  /**
   * Lead paragraph — WHAT HAPPENED. Production, usage, the season to date.
   *
   * Mirrors the shape Sleeper/Yahoo/ESPN use on a player card: a news blurb
   * followed by a separate "Analysis:" paragraph. Theirs comes from a paid
   * editorial wire (Rotowire); dated publisher evidence is composed separately from the statistical baseline.
   */
  summary: string;
  /**
   * Second paragraph — WHAT IT MEANS for the manager deciding to start, sit,
   * hold or drop. Rendered under an "Analysis:" lead-in, as on Sleeper.
   */
  analysis: string;
  /** Short badges for skimming. */
  tags: WriteupTag[];
  /** False when the sample is too small to characterise the player. */
  hasEnoughData: boolean;
  /**
   * ONE line for a roster card, e.g. "Star forward · 1.43 P/GP".
   *
   * Roster cards are ~134px tall and already carry a headshot, name, team,
   * position badge, a four-stat grid and a projection bar. The full `summary`
   * would double the card height and bury the stat line the user came for,
   * so the card gets this instead — the same read, compressed, the way
   * Sleeper/Yahoo/ESPN put a single note line on a player row.
   *
   * Deliberately carries the RATE, which the card's totals-based stat grid
   * (GP/G/A/SOG) does not show anywhere — so the line adds information
   * rather than restating what is already on screen.
   */
  cardNote: string;
  /** Tone for the card note's status dot. */
  cardTone: WriteupTone;
}

/** "21:34" -> 21.57 minutes. Returns null for missing/garbage input. */
export function parseToiToMinutes(toi: string | undefined | null): number | null {
  if (!toi || typeof toi !== 'string') return null;
  const match = toi.trim().match(/^(\d+):(\d{1,2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  return minutes + seconds / 60;
}

/**
 * Save percentage arrives as either .915 or 91.5 depending on the source.
 * Normalise to the .915 form. A goalie writeup that reads "91.5 save
 * percentage" where it means .915 is the kind of detail that costs trust.
 */
export function normalizeSavePct(raw: number | undefined | null): number | null {
  if (raw === undefined || raw === null || !Number.isFinite(raw)) return null;
  if (raw <= 0) return null;
  if (raw > 1.5) return raw / 100; // 91.5 -> 0.915
  return raw;
}

function isGoalie(position: string | undefined): boolean {
  const p = (position || '').toUpperCase();
  return p === 'G' || p.startsWith('GOAL');
}

export interface WriteupExtras {
  /** Raw attached publisher items, not generated news summaries. */
  newsItems?: readonly EditorialNewsItem[] | null;
  indexAsOf?: string | null;
  canonicalContext?: EditorialCanonicalContext | null;
  /** Internal validated context, replaced by generatePlayerWriteup before rendering. */
  selectedNews?: readonly EditorialNewsEvidence[];
  selectedAvailability?: { status: string; authority: 'verified' | 'imported_scenario'; asOf: string };
  /** Injected as-of for deterministic freshness evaluation. */
  now?: Date;
  /** Enabled scoring categories; absent means recommendations stay conditional. */
  scoringCategories?: readonly string[] | null;
  scoringWeights?: Readonly<Record<string, number>> | null;
  /** Start year of the forecast being discussed, separate from historical actuals. */
  projectionSeason?: number | null;
  /** From player_directory.birthdate. */
  age?: number | null;
  /** Regular-season goals per season on record, oldest first. From player_xg_season. */
  goalsBySeason?: ReadonlyArray<{ season: number; goals: number }> | null;
  /** Cohort-relative percentiles from the dashboard index, 0-100. */
  xgPercentile?: number | null;
  garPercentile?: number | null;
  cohortNoun?: string | null;
  cohortSize?: number | null;
  /** The projection, and how to frame it ("for 2026-27" before the opener). */
  projFp?: number | null;
  projGp?: number | null;
  posRank?: string | null;
  projectionLabel?: string | null;
  /** From player_directory.career (NHL landing endpoint, regular season only). */
  career?: CareerSummary | null;
}

/** The career document the directory refresh writes (populate_career_totals.py). */
export interface CareerSummary {
  gp?: number | null;
  goals?: number | null;
  assists?: number | null;
  points?: number | null;
  wins?: number | null;
  shutouts?: number | null;
  seasons?: number | null;
  first_season?: number | null;
  draft?: { year?: number | null; round?: number | null; overall?: number | null; team?: string | null } | null;
  awards?: ReadonlyArray<{ name: string; count: number }> | null;
}

const fmtN = (n: number) => n.toLocaleString('en-US');

/**
 * The career, as one sentence and the tags a legend has earned. Regular
 * season only, plain numbers, no adjectives: "897 goals" says legend on
 * its own. Awards are the trophies with a count, the three most won.
 */
export function careerSentences(career: CareerSummary | null | undefined, goalie: boolean): { summary: string[]; tags: WriteupTag[] } {
  const summary: string[] = [];
  const tags: WriteupTag[] = [];
  if (!career) return { summary, tags };
  const gp = career.gp ?? 0;
  const seasons = career.seasons ?? 0;
  if (gp > 0) {
    const over = seasons > 1 ? ` over ${seasons} NHL seasons` : '';
    if (goalie) {
      const wins = career.wins ?? 0;
      const so = career.shutouts ?? 0;
      summary.push(`Career: ${fmtN(wins)} wins and ${fmtN(so)} shutouts in ${fmtN(gp)} games${over}.`);
      if (wins >= 300) tags.push({ label: '300 wins', tone: 'positive' });
    } else {
      const g = career.goals ?? 0;
      const p = career.points ?? 0;
      summary.push(`Career: ${fmtN(g)} goals and ${fmtN(p)} points in ${fmtN(gp)} games${over}.`);
      if (g >= 500) tags.push({ label: '500-goal club', tone: 'positive' });
      if (p >= 1000) tags.push({ label: '1,000-point club', tone: 'positive' });
    }
    if (gp >= 1000) tags.push({ label: '1,000 games', tone: 'neutral' });
  }
  const awards = [...(career.awards ?? [])].filter((a) => a.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
  if (awards.length) {
    summary.push(`Trophies: ${awards.map((a) => (a.count > 1 ? `${shortTrophy(a.name)} x${a.count}` : shortTrophy(a.name))).join(', ')}.`);
  }
  const d = career.draft;
  if (d && d.overall != null && d.year != null && d.overall <= 10) {
    summary.push(`Drafted ${ordinalWord(d.overall)} overall in ${d.year}${d.team ? ` by ${d.team}` : ''}.`);
  } else if (career.gp && career.gp > 0 && d === null) {
    summary.push('Undrafted.');
  }
  return { summary, tags };
}

/** "Maurice \"Rocket\" Richard Trophy" -> "Rocket Richard"; "Hart Memorial Trophy" -> "Hart". */
export function shortTrophy(name: string): string {
  const quoted = name.match(/"([^"]+)"\s+(\w+)/);
  if (quoted) return `${quoted[1]} ${quoted[2]}`;
  return name
    .replace(/\bMemorial\b/g, '')
    .replace(/\bTrophy\b|\bAward\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 2025 -> "2025-26". */
function seasonWord(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`;
}

function historicalStatsSeason(player: WriteupPlayer, extras?: WriteupExtras): number | null {
  const season = player.statsSeason;
  const projectionSeason = extras?.projectionSeason ?? getProjectionsSeason();
  return Number.isInteger(season) && (season as number) >= 1900 && (season as number) < projectionSeason
    ? season as number : null;
}

function ordinalWord(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

export function applyWriteupExtras(writeup: PlayerWriteup, player: WriteupPlayer, extras: WriteupExtras | undefined): PlayerWriteup {
  if (!extras || !writeup.hasEnoughData) return writeup;
  const goalie = isGoalie(player.position);
  const summary: string[] = [];
  const analysis: string[] = [];
  const tags = [...writeup.tags];

  // The career on record. "Nine straight 30-goal seasons" is a stat; it is
  // the one sentence a legend's card owes him. Plain numbers, no brand.
  const seasons = [...new Map((extras.goalsBySeason ?? [])
    .filter(r => Number.isInteger(r.season) && Number.isFinite(r.goals) && r.goals >= 0)
    .map(r => [r.season, r])).values()].sort((a, b) => a.season - b.season);
  const consecutive = seasons.every((r, i) => i === 0 || r.season === seasons[i - 1].season + 1);
  if (!goalie && seasons.length >= 2) {
    const n = seasons.length;
    const minGoals = Math.min(...seasons.map((r) => r.goals));
    const best = seasons.reduce((a, b) => (b.goals > a.goals ? b : a));
    const age = extras.age != null ? `At ${extras.age}, ` : '';
    if (minGoals >= 30) {
      summary.push(`${age}${age ? 'he' : 'He'} has ${countWord(n)} ${consecutive ? 'straight seasons' : 'seasons'} of 30 goals or more on record.`);
      if (n >= 5 && consecutive) tags.push({ label: `${n} straight 30-goal seasons`, tone: 'positive' });
    } else if (minGoals >= 20) {
      summary.push(`${age}${age ? 'he' : 'He'} has ${countWord(n)} ${consecutive ? 'straight seasons' : 'seasons'} of 20 goals or more on record.`);
    } else if (best.goals >= 30) {
      summary.push(`${age}${age ? 'his' : 'His'} best season on record is ${best.goals} goals in ${seasonWord(best.season)}.`);
    } else if (age) {
      summary.push(`He is ${extras.age}.`);
    }
  } else if (extras.age != null && !goalie) {
    summary.push(`He is ${extras.age}.`);
  }
  if (extras.age != null && extras.age >= 36) tags.push({ label: 'Veteran', tone: 'neutral' });

  // The career on record, from the directory: what a legend's card owes him.
  const career = careerSentences(extras.career, goalie);
  summary.push(...career.summary);
  for (const t of career.tags) if (!tags.some((x) => x.label === t.label)) tags.push(t);

  // The cohort reads, only when they say something: the top or bottom fifth.
  const noun = extras.cohortNoun ?? null;
  const notable = (p: number | null | undefined) => p != null && (p >= 80 || p <= 20);
  if (!goalie && noun && (notable(extras.xgPercentile) || notable(extras.garPercentile))) {
    const bits: string[] = [];
    if (notable(extras.xgPercentile)) bits.push(`xG/60 in the ${ordinalWord(extras.xgPercentile as number)} percentile`);
    if (notable(extras.garPercentile)) bits.push(`GAR/60 in the ${ordinalWord(extras.garPercentile as number)}`);
    const period = historicalStatsSeason(player, extras);
    analysis.push(`${period === null ? '' : `In ${seasonWord(period)}, `}${bits.join(', ')} of ${noun}.`.replace(/^x/, 'X'));
    if ((extras.garPercentile ?? 0) >= 90) tags.push({ label: 'Elite GAR', tone: 'positive' });
  }

  // The projection, framed by the host: a season before the opener, the
  // rest of it after. Numbers only.
  if (extras.projFp != null && Number.isFinite(extras.projFp)) {
    const fp = Math.round(extras.projFp);
    const gp = extras.projGp != null ? ` over ${Math.round(extras.projGp)} ${goalie ? 'starts' : 'games'}` : '';
    const rank = extras.posRank ? ` (${extras.posRank})` : '';
    const when = extras.projectionLabel ? ` ${extras.projectionLabel}` : '';
    analysis.push(`Projects to ${fp} fantasy points${gp}${when}${rank}.`);
  }

  return {
    ...writeup,
    summary: [writeup.summary, ...summary].filter(Boolean).join(' '),
    analysis: [writeup.analysis, ...analysis].filter(Boolean).join(' '),
    tags,
  };
}

export function generatePlayerWriteup(player: WriteupPlayer | null | undefined, extras?: WriteupExtras): PlayerWriteup {
  if (!player) {
    return {
      headline: 'No player selected',
      summary: 'Select a player to see their scouting summary.',
      analysis: '',
      tags: [],
      hasEnoughData: false,
      cardNote: '',
      cardTone: 'neutral',
    };
  }

  const evidence = selectEditorialNews(player, extras?.newsItems, extras?.now);
  const canonical = canonicalEditorialContext(player, extras?.canonicalContext, extras?.now);
  const base = profileWriteup(player, { ...extras, projectionSeason: extras?.projectionSeason ?? getProjectionsSeason(),
    selectedNews: evidence, selectedAvailability: canonical.availability,
  });
  const enriched = applyWriteupExtras(base, player, extras);
  const news = editorialNewsText(player.name, evidence);
  const profileSummary = (news.summary || canonical.summary) && enriched.summary.startsWith(`${player.name} `)
    ? `He ${enriched.summary.slice(player.name.length + 1)}` : enriched.summary;
  const writeup: PlayerWriteup = {
    ...enriched,
    editorialVersion: CITRUS_EDITORIAL_VERSION,
    sourceContext: { actualsSeason: player.statsSeason ?? null, projectionSeason: extras?.projectionSeason ?? null, indexAsOf: extras?.indexAsOf ?? null,
      ...(canonical.revision ? { canonicalRevision: canonical.revision, canonicalRunId: canonical.runId } : {}),
    },
    ...(canonical.sources.length ? { canonicalSources: canonical.sources } : {}),
    newsSources: evidence,
    summary: [news.summary, canonical.summary, profileSummary].filter(Boolean).join(' '),
    analysis: [enriched.analysis, canonical.analysis].filter(Boolean).join(' '),
  };

  // Injury status outranks anything the stat line says: a 1.2 PPG winger on IR
  // is a bench decision tonight regardless of how good the season has been.
  // The card has room for ONE line, so availability takes it: whether he can
  // play tonight beats how good the season has been.
  if (player.status === 'IR') {
    return {
      ...writeup,
      tags: [{ label: 'Injured reserve', tone: 'caution' }, ...writeup.tags],
      summary: `Currently on injured reserve. ${writeup.summary}`,
      cardNote: 'On injured reserve',
      cardTone: 'caution',
    };
  }
  if (player.status === 'GTD') {
    return {
      ...writeup,
      tags: [{ label: 'Game-time decision', tone: 'caution' }, ...writeup.tags],
      summary: `Listed as a game-time decision, so check his status before puck drop. ${writeup.summary}`,
      cardNote: 'Game-time decision',
      cardTone: 'caution',
    };
  }
  if (player.status === 'SUSP') {
    return {
      ...writeup,
      tags: [{ label: 'Suspended', tone: 'caution' }, ...writeup.tags],
      summary: `Currently suspended and unavailable. ${writeup.summary}`,
      cardNote: 'Suspended, unavailable',
      cardTone: 'caution',
    };
  }

  return writeup;
}
