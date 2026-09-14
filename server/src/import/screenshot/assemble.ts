/**
 * Pages the reader extracted, grouped and reconciled into ImportedSeason.
 *
 * Pure. Every decision a screenshot forces is made here and named in
 * `warnings`, which the review screen shows before anything is written:
 *
 *   - Identity. There is no account id on a screenshot, so a manager is
 *     keyed on their printed name (name:<normalised>), the same key the
 *     foundation's pasted-standings path uses. A standings row with no
 *     manager name falls back to the team name, and says so, because team
 *     names change and the commissioner may need to merge later.
 *   - Teams across pages. A draft page and a standings page print the same
 *     team; the match is on the normalised name, then on a prefix so a
 *     truncated "Dangle Dynas..." still lands. A name found on no
 *     standings page becomes a team of its own with a warning.
 *   - Champion. The standings page's champion mark wins; a playoff page's
 *     final is the fallback and fills playoffFinish for both finalists.
 *   - Finished. A season before the current one is finished. The current
 *     season is finished only when a page marks a champion. The
 *     commissioner can override either way.
 *   - Players. externalPlayerId is name:<normalised name>[|<NHL abbr>] so
 *     the crosswalk resolves each printed name once per platform; two
 *     players with one name (there are two Sebastian Ahos) stay apart
 *     when the page prints the NHL team.
 */
import { createHash } from 'crypto';
import type {
  ImportedAward, ImportedKeeperDesignation, ImportedMatchup, ImportedPick, ImportedPickOwnership, ImportedPlayerRef, ImportedScoringType,
  ImportedSeason, ImportedSettings, ImportedTeam, ImportedTransaction, ImportPlatform,
} from '../types';
import type { ExtractedPage, ExtractedSettings, StandingsRow } from './schema';
import { translateSettings } from './settings';

export interface AssembleOptions {
  /** The platform the commissioner named; a page that says otherwise keeps its own. */
  platform: ImportPlatform;
  /** START year of the season being played now: everything earlier is finished. */
  currentSeason: number;
  /** Stable id for the league at the source; the league name slug when there is no real id. */
  externalLeagueId: string;
  leagueName?: string | null;
  /** Commissioner overrides: season -> finished. */
  finished?: Record<number, boolean>;
  /** Dynasty: every player on a roster page is a keeper (no round cost). */
  rostersAsKeepers?: boolean;
}

export interface AssembledSeasons {
  seasons: ImportedSeason[];
  /** Pages that could not be placed and why; the review screen blocks on these. */
  unplaced: Array<{ index: number; reason: string }>;
}

export function normName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s'&-]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function playerRef(name: string, teamAbbr?: string | null, position?: string | null): ImportedPlayerRef {
  const abbr = teamAbbr ? teamAbbr.trim().toUpperCase() : null;
  const key = normName(name);
  return {
    externalPlayerId: abbr ? `name:${key}|${abbr}` : `name:${key}`,
    name: name.trim(),
    teamAbbr: abbr || null,
    jerseyNumber: null,
    position: position ? position.trim().toUpperCase() : null,
  };
}

const PLATFORM_FROM_PAGE: Record<string, ImportPlatform | null> = { yahoo: 'yahoo', espn: 'espn', fantrax: 'fantrax', cbs: 'cbs', sleeper: 'sleeper', unknown: null };

/** Team registry for one season: names on any page resolve to one external team id. */
class TeamBook {
  private readonly byNorm = new Map<string, ImportedTeam>();
  readonly teams: ImportedTeam[] = [];
  readonly warnings: string[] = [];

  constructor(private readonly season: number) {}

  /** Register a standings row: the authoritative list. */
  add(row: StandingsRow): ImportedTeam {
    const key = normName(row.teamName);
    const existing = this.byNorm.get(key);
    if (existing) return existing;
    const managerName = row.managerName?.trim() || null;
    if (!managerName) this.warnings.push(`${this.season}: "${row.teamName}" has no manager name on the standings page, so the team name stands in for the person. Merge later if this manager appears under another team name.`);
    const identity = managerName ? `name:${normName(managerName)}` : `team:${key}`;
    const team: ImportedTeam = {
      externalTeamId: `team:${key}`,
      teamName: row.teamName.trim(),
      managers: [{ externalManagerId: identity, displayName: managerName ?? row.teamName.trim() }],
      finalRank: row.rank ?? null,
      finalRankSource: row.rank != null ? 'source_final' : null,
      playoffSeed: row.playoffSeed ?? null,
      wins: row.wins ?? null,
      losses: row.losses ?? null,
      ties: row.ties ?? null,
      pointsFor: row.pointsFor ?? null,
      pointsAgainst: row.pointsAgainst ?? null,
      categoryRecord: row.categoryRecord ?? null,
      madePlayoffs: row.madePlayoffs ?? null,
      playoffFinish: row.playoffFinish ?? (row.isChampion ? 1 : null),
    };
    this.byNorm.set(key, team);
    this.teams.push(team);
    return team;
  }

  /** Resolve a name printed on another page; creates a team when nothing matches. */
  resolve(name: string, pageKind: string): ImportedTeam {
    const key = normName(name);
    const exact = this.byNorm.get(key);
    if (exact) return exact;
    // A truncated name on a narrow page: "dangle dynas" against "dangle dynasty".
    const stem = key.replace(/\.+$/, '').trim();
    if (stem.length >= 4) {
      const candidates = [...this.byNorm.entries()].filter(([k]) => k.startsWith(stem) || stem.startsWith(k));
      if (candidates.length === 1) {
        this.byNorm.set(key, candidates[0][1]);
        return candidates[0][1];
      }
    }
    this.warnings.push(`${this.season}: "${name}" on the ${pageKind} page matches no team on the standings page; it was added as its own team.`);
    return this.add({ teamName: name });
  }

  /** A person named without a team (an award winner): their team this season, or a team standing in for them. */
  resolveManager(managerName: string, pageKind: string): ImportedTeam {
    const key = normName(managerName);
    const byManager = this.teams.find((t) => t.managers.some((m) => normName(m.displayName) === key));
    if (byManager) return byManager;
    const byTeam = this.byNorm.get(key);
    if (byTeam) return byTeam;
    this.warnings.push(`${this.season}: "${managerName}" on the ${pageKind} page matches no manager or team this season; a row was made for them.`);
    return this.add({ teamName: managerName, managerName });
  }
}

function txId(parts: Array<string | number | null | undefined>): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 24);
}

function inferScoringType(teams: ImportedTeam[], matchups: ImportedMatchup[]): ImportedScoringType {
  if (teams.some((t) => t.categoryRecord) || matchups.some((m) => m.homeCatWins != null)) return 'h2h_categories';
  const hasRecord = teams.some((t) => t.wins != null);
  const hasPoints = teams.some((t) => t.pointsFor != null) || matchups.some((m) => m.homeScore != null);
  if (hasRecord && hasPoints) return 'h2h_points';
  if (hasPoints) return 'points';
  // A record with no points column is a categories league counting weeks or
  // a points league whose page hid the column; neither is worth guessing.
  return 'unknown';
}

function emptySettings(leagueName: string): ImportedSettings {
  return {
    leagueName, scoringType: 'unknown', scoringItems: [], rosterSlots: [],
    regularSeasonWeeks: null, playoffTeamCount: null, playoffWeeks: null,
    keeperCount: null, keeperOrderType: null, draftType: null, usesFaab: null, isPublic: null,
  };
}

export function assembleSeasons(pages: ExtractedPage[], opts: AssembleOptions): AssembledSeasons {
  const unplaced: AssembledSeasons['unplaced'] = [];
  const bySeason = new Map<number, ExtractedPage[]>();
  const seasonless: ExtractedPage[] = [];
  for (const page of pages) {
    if (page.kind === 'other') { unplaced.push({ index: page.index, reason: 'Not a league page.' }); continue; }
    // A league history page carries many seasons; each row becomes that season's page.
    if (page.kind === 'champions') {
      const rows = page.champions ?? [];
      if (!rows.length) { unplaced.push({ index: page.index, reason: 'No seasons were read from the champions page.' }); continue; }
      for (const row of rows) {
        const list = bySeason.get(row.season) ?? [];
        list.push({ ...page, season: row.season, champions: [row] });
        bySeason.set(row.season, list);
      }
      continue;
    }
    if (page.kind === 'awards') {
      const rows = page.awards ?? [];
      if (!rows.length) { unplaced.push({ index: page.index, reason: 'No awards were read from the page.' }); continue; }
      const dated = rows.filter((r) => r.season != null);
      const allTime = rows.filter((r) => r.season == null);
      for (const row of dated) {
        const list = bySeason.get(row.season!) ?? [];
        list.push({ ...page, season: row.season!, awards: [row] });
        bySeason.set(row.season!, list);
      }
      if (allTime.length) seasonless.push({ ...page, awards: allTime });
      continue;
    }
    if (page.season == null) {
      // Settings, keepers, rosters and pick ownership describe the league as it stands; they attach to the newest season.
      if (page.kind === 'settings' || page.kind === 'keepers' || page.kind === 'roster' || page.kind === 'pick_ownership') { seasonless.push(page); continue; }
      unplaced.push({ index: page.index, reason: 'No season on the page. Set the season and read it again.' });
      continue;
    }
    const list = bySeason.get(page.season) ?? [];
    list.push(page);
    bySeason.set(page.season, list);
  }
  if (seasonless.length) {
    const newest = Math.max(...bySeason.keys(), -Infinity);
    if (Number.isFinite(newest)) {
      bySeason.get(newest)!.push(...seasonless.map((p) => ({ ...p, season: newest })));
    } else {
      for (const p of seasonless) unplaced.push({ index: p.index, reason: 'No season on the page and no standings or champions page to attach it to.' });
    }
  }

  const seasons: ImportedSeason[] = [];
  const leagueName = opts.leagueName?.trim() || pages.find((p) => p.leagueName)?.leagueName?.trim() || 'Imported league';

  for (const [season, seasonPages] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    const warnings: string[] = [];
    const book = new TeamBook(season);
    const platformVotes = seasonPages.map((p) => PLATFORM_FROM_PAGE[p.platform]).filter((p): p is ImportPlatform => p != null);
    const platform: ImportPlatform = opts.platform !== 'manual' ? opts.platform : platformVotes[0] ?? 'manual';
    for (const p of seasonPages) if (p.notes) warnings.push(`${season}, image ${p.index + 1}: ${p.notes}`);
    for (const p of seasonPages) if (p.confidence === 'low') warnings.push(`${season}, image ${p.index + 1}: the reader was not confident about this page. Check every number.`);

    // 1. Standings define the teams.
    const standingsPages = seasonPages.filter((p) => p.kind === 'standings' && p.standings?.length);
    if (standingsPages.length > 1) warnings.push(`${season}: ${standingsPages.length} standings pages; rows were merged by team name.`);
    for (const p of standingsPages) for (const row of p.standings ?? []) book.add(row);
    // 1b. A league history page names the champion (and the runner-up) even when no standings page exists.
    for (const p of seasonPages.filter((p) => p.kind === 'champions')) {
      for (const row of p.champions ?? []) {
        const champ = book.add({ teamName: row.championTeam, managerName: row.championManager ?? null, rank: 1, isChampion: true, madePlayoffs: true });
        if (champ.playoffFinish == null) champ.playoffFinish = 1;
        if (champ.finalRank == null) { champ.finalRank = 1; champ.finalRankSource = 'source_final'; }
        if (champ.madePlayoffs == null) champ.madePlayoffs = true;
        if (row.runnerUpTeam) {
          const runner = book.add({ teamName: row.runnerUpTeam, managerName: row.runnerUpManager ?? null, rank: 2, madePlayoffs: true });
          if (runner.playoffFinish == null) runner.playoffFinish = 2;
          if (runner.finalRank == null) { runner.finalRank = 2; runner.finalRankSource = 'source_final'; }
          if (runner.madePlayoffs == null) runner.madePlayoffs = true;
        }
      }
    }
    const hasChampionsPage = seasonPages.some((p) => p.kind === 'champions');
    if (standingsPages.length === 0 && !hasChampionsPage) warnings.push(`${season}: no standings page. Teams come from the other pages and have no record.`);

    // 2. Playoffs: finishes, playoff membership, and matchups where a week is printed.
    const matchups: ImportedMatchup[] = [];
    for (const p of seasonPages.filter((p) => p.kind === 'playoffs')) {
      for (const m of p.playoffs ?? []) {
        const home = book.resolve(m.homeTeam, 'playoffs');
        const away = m.awayTeam ? book.resolve(m.awayTeam, 'playoffs') : null;
        const consolation = m.round === 'consolation';
        if (!consolation) {
          if (home.madePlayoffs == null) home.madePlayoffs = true;
          if (away && away.madePlayoffs == null) away.madePlayoffs = true;
        }
        const winner = m.winner ?? (m.homeScore != null && m.awayScore != null ? (m.homeScore > m.awayScore ? 'home' : m.awayScore > m.homeScore ? 'away' : 'tie') : null);
        if (m.round === 'final' && winner && winner !== 'tie' && away) {
          const w = winner === 'home' ? home : away;
          const l = winner === 'home' ? away : home;
          if (w.playoffFinish == null) w.playoffFinish = 1;
          if (l.playoffFinish == null) l.playoffFinish = 2;
        }
        if (m.round === 'third_place' && winner && winner !== 'tie' && away) {
          const w = winner === 'home' ? home : away;
          if (w.playoffFinish == null) w.playoffFinish = 3;
        }
        if (m.week != null) {
          matchups.push({
            week: m.week, homeExternalTeamId: home.externalTeamId, awayExternalTeamId: away?.externalTeamId ?? null,
            homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null, homeCatWins: null, homeCatLosses: null, homeCatTies: null, categoryResults: null,
            isPlayoff: !consolation, isConsolation: consolation, isChampionship: m.round === 'final', winner, externalMatchupId: null,
          });
        }
      }
    }

    // 3. Scoreboards: one week each.
    for (const p of seasonPages.filter((p) => p.kind === 'scoreboard' && p.scoreboard)) {
      const sb = p.scoreboard!;
      for (const m of sb.matchups) {
        const home = book.resolve(m.homeTeam, 'scoreboard');
        const away = m.awayTeam ? book.resolve(m.awayTeam, 'scoreboard') : null;
        const cats = m.homeCatWins != null;
        const winner = m.winner ?? (cats
          ? (m.homeCatWins! > (m.homeCatLosses ?? 0) ? 'home' : m.homeCatWins! < (m.homeCatLosses ?? 0) ? 'away' : 'tie')
          : m.homeScore != null && m.awayScore != null ? (m.homeScore > m.awayScore ? 'home' : m.awayScore > m.homeScore ? 'away' : 'tie') : null);
        matchups.push({
          week: sb.week, homeExternalTeamId: home.externalTeamId, awayExternalTeamId: away?.externalTeamId ?? null,
          homeScore: cats ? null : m.homeScore ?? null, awayScore: cats ? null : m.awayScore ?? null,
          homeCatWins: m.homeCatWins ?? null, homeCatLosses: m.homeCatLosses ?? null, homeCatTies: m.homeCatTies ?? null, categoryResults: null,
          isPlayoff: sb.isPlayoff ?? false, isConsolation: false, isChampionship: false, winner, externalMatchupId: null,
        });
      }
    }

    // 4. Draft results.
    const picks: ImportedPick[] = [];
    const draftPages = seasonPages.filter((p) => p.kind === 'draft' && p.picks?.length);
    let overallCounter = 0;
    for (const p of draftPages) {
      for (const row of p.picks ?? []) {
        overallCounter += 1;
        const overall = row.overall ?? (row.round != null && row.pickInRound != null && book.teams.length ? (row.round - 1) * book.teams.length + row.pickInRound : overallCounter);
        picks.push({
          overallPick: overall, round: row.round ?? null, pickInRound: row.pickInRound ?? null,
          externalTeamId: book.resolve(row.teamName, 'draft').externalTeamId,
          player: playerRef(row.playerName, row.playerTeamAbbr, row.position),
          isKeeper: row.isKeeper ?? false, keeperCost: row.keeperCost ?? null, auctionCost: row.auctionCost ?? null,
        });
      }
    }
    const seenOverall = new Set<number>();
    for (const pick of picks) {
      if (seenOverall.has(pick.overallPick)) { warnings.push(`${season}: two draft picks share overall number ${pick.overallPick}; check the draft page.`); break; }
      seenOverall.add(pick.overallPick);
    }

    // 5. Transactions, one asset per row.
    const transactions: ImportedTransaction[] = [];
    for (const p of seasonPages.filter((p) => p.kind === 'transactions')) {
      for (const row of p.transactions ?? []) {
        const team = book.resolve(row.teamName, 'transactions');
        const counterparty = row.counterpartyTeamName ? book.resolve(row.counterpartyTeamName, 'transactions') : null;
        const isPick = row.pickRound != null;
        if (!isPick && !row.playerName) { warnings.push(`${season}: a ${row.type} for "${row.teamName}" names neither a player nor a pick and was skipped.`); continue; }
        const pickSeason = row.pickSeason ?? (isPick ? season + 1 : null);
        transactions.push({
          externalTransactionId: txId([row.date, row.type, team.externalTeamId, counterparty?.externalTeamId, row.playerName, row.pickSeason, row.pickRound]),
          occurredAt: row.date && /^\d{4}-\d{2}-\d{2}/.test(row.date) ? new Date(row.date).toISOString() : null,
          type: row.type,
          externalTeamId: team.externalTeamId,
          counterpartyExternalTeamId: counterparty?.externalTeamId ?? null,
          player: isPick ? null : playerRef(row.playerName!, row.playerTeamAbbr, row.position),
          pick: isPick ? { season: pickSeason!, round: row.pickRound!, originalExternalTeamId: row.pickOriginalTeamName ? book.resolve(row.pickOriginalTeamName, 'transactions').externalTeamId : null } : null,
          faabBid: row.faabBid ?? null,
        });
        if (isPick && row.pickSeason == null) warnings.push(`${season}: a traded pick had no draft year on the page; assumed the next draft (${pickSeason}).`);
      }
    }

    // 6. Keepers, and rosters when the league is dynasty.
    const keepers: ImportedKeeperDesignation[] = [];
    for (const p of seasonPages.filter((p) => p.kind === 'keepers')) {
      for (const row of p.keepers ?? []) {
        keepers.push({ externalTeamId: book.resolve(row.teamName, 'keepers').externalTeamId, player: playerRef(row.playerName, row.playerTeamAbbr, row.position), round: row.round ?? null, roundNext: row.roundNext ?? null });
      }
    }
    const rosterPages = seasonPages.filter((p) => p.kind === 'roster' && p.roster?.length);
    if (rosterPages.length && opts.rostersAsKeepers) {
      for (const p of rosterPages) for (const team of p.roster ?? []) {
        const ext = book.resolve(team.teamName, 'roster').externalTeamId;
        for (const pl of team.players) keepers.push({ externalTeamId: ext, player: playerRef(pl.playerName, pl.playerTeamAbbr, pl.position), round: null, roundNext: null });
      }
    } else if (rosterPages.length) {
      warnings.push(`${season}: roster pages were read but not used. Turn on "keep whole rosters" for a dynasty league to carry them as keepers.`);
    }

    // 7. Future pick ownership.
    const pickOwnership: ImportedPickOwnership[] = [];
    for (const p of seasonPages.filter((p) => p.kind === 'pick_ownership')) {
      for (const row of p.pickOwnership ?? []) {
        const original = book.resolve(row.originalTeamName, 'pick ownership');
        const owner = book.resolve(row.ownerTeamName, 'pick ownership');
        if (original.externalTeamId === owner.externalTeamId) continue;
        pickOwnership.push({ draftSeason: row.draftSeason, round: row.round, originalExternalTeamId: original.externalTeamId, ownerExternalTeamId: owner.externalTeamId });
      }
    }

    // 7b. The league's own awards, kept under the name the league uses.
    const awards: ImportedAward[] = [];
    for (const p of seasonPages.filter((p) => p.kind === 'awards')) {
      for (const row of p.awards ?? []) {
        const winner = row.winnerTeam?.trim() || row.winnerManager?.trim() || null;
        const team = row.winnerTeam?.trim() ? book.resolve(row.winnerTeam, 'awards') : row.winnerManager?.trim() ? book.resolveManager(row.winnerManager, 'awards') : null;
        awards.push({ season: row.season ?? null, name: row.award.trim(), externalTeamId: team?.externalTeamId ?? null, winnerName: winner, note: row.note?.trim() || null });
      }
    }

    // 8. Settings.
    const settingsPage = seasonPages.find((p) => p.kind === 'settings' && p.settings);
    const translated = settingsPage ? translateSettings(settingsPage.settings as ExtractedSettings, platform, leagueName) : { settings: emptySettings(leagueName), warnings: [] as string[] };
    const settings = translated.settings;
    if (settings.scoringType === 'unknown') settings.scoringType = inferScoringType(book.teams, matchups);
    for (const w of translated.warnings) warnings.push(`${season}: ${w}`);

    // 9. Finished, and the champion that follows from it.
    const anyChampion = book.teams.some((t) => t.playoffFinish === 1);
    const isFinished = opts.finished?.[season] ?? (season < opts.currentSeason ? true : anyChampion);
    if (isFinished && !anyChampion && book.teams.some((t) => t.finalRank === 1)) warnings.push(`${season}: no champion mark on the page; the team ranked first is taken as champion.`);
    if (isFinished && !anyChampion && !book.teams.some((t) => t.finalRank === 1)) warnings.push(`${season}: no champion and no rank 1 on the page; the season lands without a champion.`);

    warnings.push(...book.warnings);
    seasons.push({
      platform, externalLeagueId: opts.externalLeagueId, externalSeasonKey: String(season), season, isFinished,
      settings, teams: book.teams, matchups, picks, keepers, transactions, pickOwnership, awards,
      previousSeasons: [], warnings,
    });
  }

  return { seasons, unplaced };
}
