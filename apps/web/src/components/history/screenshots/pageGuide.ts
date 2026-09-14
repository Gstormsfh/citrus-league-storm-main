/**
 * What to screenshot, in each platform's own words, so the commissioner
 * knows exactly which page Citrus is asking for. Labels are the menu names
 * the platforms use on the web as of September 2026; the reader judges each
 * page by its content, so a renamed menu still reads.
 *
 * The first row on every platform is the one that matters most: the page
 * that lists every past champion. One screenshot of it gives the trophy
 * room its seasons, its champions and every career honour.
 */
import type { ImportPlatform, PageKind } from '@/api/imports';

export interface GuideRow {
  kind: PageKind;
  /** The page as the platform names it. */
  label: string;
  /** How to get there, in the platform's menu words. */
  path: string;
  /** What Citrus gets from it. */
  gives: string;
  essential?: boolean;
  perSeason?: boolean;
}

const YAHOO: GuideRow[] = [
  { kind: 'champions', label: 'League History', path: 'League menu, then History (the page listing each past season and its champion)', gives: 'Every season, every champion and runner-up, career titles and droughts', essential: true },
  { kind: 'standings', label: 'Standings', path: 'League menu, then Standings, with the season picker set to a past year', gives: 'Final records and points for that season', perSeason: true },
  { kind: 'playoffs', label: 'Playoffs', path: 'League menu, then Playoffs, for a past season', gives: 'The bracket, third place, who made it', perSeason: true },
  { kind: 'draft', label: 'Draft Results', path: 'League menu, then Draft Results, for a past season', gives: 'Every pick, keepers marked', perSeason: true },
  { kind: 'transactions', label: 'Transactions', path: 'League menu, then Transactions (Trades filter for a keeper league)', gives: 'Trades, including traded draft picks, adds and drops', perSeason: true },
  { kind: 'keepers', label: 'Keepers', path: 'League menu, then Keepers, or the Keeper Tools page', gives: 'This year\'s keeper list and what each costs' },
  { kind: 'pick_ownership', label: 'Draft Picks (traded)', path: 'The Keeper Tools page, Traded Draft Picks; or the trade log', gives: 'Who owns which future pick' },
  { kind: 'settings', label: 'League Settings', path: 'League menu, then Settings', gives: 'Scoring categories, roster spots, keeper rule' },
];

const ESPN: GuideRow[] = [
  { kind: 'champions', label: 'League History', path: 'League menu, then History (past seasons with their champions)', gives: 'Every season, every champion and runner-up, career titles and droughts', essential: true },
  { kind: 'standings', label: 'Standings', path: 'League menu, then Standings, with a past season selected', gives: 'Final records and points for that season', perSeason: true },
  { kind: 'playoffs', label: 'Playoff Bracket', path: 'Scoreboard during the playoff weeks, or the bracket view', gives: 'The bracket, who made it', perSeason: true },
  { kind: 'draft', label: 'Draft Recap', path: 'League menu, then Draft Recap, for a past season', gives: 'Every pick, keepers marked', perSeason: true },
  { kind: 'transactions', label: 'Transactions', path: 'League menu, then Transactions', gives: 'Trades, adds and drops', perSeason: true },
  { kind: 'keepers', label: 'Keepers', path: 'League menu, then Keepers (keeper leagues)', gives: 'This year\'s keeper list' },
  { kind: 'settings', label: 'League Settings', path: 'League menu, then Settings', gives: 'Scoring, roster spots, keeper rule' },
];

const FANTRAX: GuideRow[] = [
  { kind: 'champions', label: 'League History', path: 'League menu, then History or Past Seasons (each season with its champion)', gives: 'Every season, every champion and runner-up, career titles and droughts', essential: true },
  { kind: 'standings', label: 'Standings', path: 'Standings, with a past season chosen at the top', gives: 'Final records and points for that season', perSeason: true },
  { kind: 'playoffs', label: 'Playoffs', path: 'Standings, Playoffs tab', gives: 'The bracket, who made it', perSeason: true },
  { kind: 'draft', label: 'Draft Results', path: 'Draft menu, then Draft Results, for a past season', gives: 'Every pick, keepers marked', perSeason: true },
  { kind: 'transactions', label: 'Transactions', path: 'Transactions, or Trades, for a past season', gives: 'Trades including traded picks, adds and drops', perSeason: true },
  { kind: 'keepers', label: 'Keepers', path: 'Rosters with the keeper column, or the Keepers page', gives: 'This year\'s keeper list and what each costs' },
  { kind: 'roster', label: 'Rosters', path: 'Rosters, every team (dynasty: the whole roster carries over)', gives: 'Full rosters as keepers for a dynasty league' },
  { kind: 'pick_ownership', label: 'Draft Picks', path: 'Draft menu, then Draft Picks (future picks and who owns them)', gives: 'Who owns which future pick' },
  { kind: 'settings', label: 'League Settings', path: 'Commissioner or League menu, then Settings, Scoring and Roster', gives: 'Scoring categories, roster spots, keeper rule' },
];

const CBS: GuideRow[] = [
  { kind: 'champions', label: 'League History', path: 'League menu, then History (each past season with its champion)', gives: 'Every season, every champion and runner-up, career titles and droughts', essential: true },
  { kind: 'standings', label: 'Standings', path: 'Standings, with a past season selected', gives: 'Final records and points for that season', perSeason: true },
  { kind: 'draft', label: 'Draft Results', path: 'Draft menu, then Draft Results', gives: 'Every pick, keepers marked', perSeason: true },
  { kind: 'transactions', label: 'Transactions', path: 'Transactions, or Trade History', gives: 'Trades, adds and drops', perSeason: true },
  { kind: 'keepers', label: 'Keepers', path: 'Keepers page (keeper leagues)', gives: 'This year\'s keeper list' },
  { kind: 'settings', label: 'League Rules', path: 'League menu, then Rules or Settings', gives: 'Scoring, roster spots, keeper rule' },
];

const SLEEPER: GuideRow[] = [
  { kind: 'champions', label: 'League History', path: 'League, then History or the Trophy Room', gives: 'Every season and its champion', essential: true },
  { kind: 'standings', label: 'Standings', path: 'League, then Standings, for a past season', gives: 'Final records', perSeason: true },
  { kind: 'draft', label: 'Draft Board', path: 'Drafts, then a past draft', gives: 'Every pick', perSeason: true },
  { kind: 'transactions', label: 'Transactions', path: 'League, then Transactions', gives: 'Trades including traded picks', perSeason: true },
  { kind: 'pick_ownership', label: 'Draft Picks', path: 'Team, then Draft Picks (owned future picks)', gives: 'Who owns which future pick' },
  { kind: 'settings', label: 'League Settings', path: 'League, then Settings', gives: 'Scoring, roster spots' },
];

const ANYWHERE: GuideRow[] = [
  { kind: 'champions', label: 'Past champions', path: 'Any list of seasons with who won: a page, a spreadsheet, a photo of the plaque', gives: 'Every season, every champion, career titles and droughts', essential: true },
  { kind: 'awards', label: 'League awards', path: 'The league\'s own trophies by season and winner: a spreadsheet, a group chat message, a photo', gives: 'Your awards, under your names, ready to keep handing out' },
  { kind: 'standings', label: 'Final standings', path: 'Any table of teams with records, one per season', gives: 'Final records', perSeason: true },
  { kind: 'draft', label: 'Draft results', path: 'Any list of picks in order', gives: 'Every pick', perSeason: true },
  { kind: 'transactions', label: 'Trades', path: 'Any trade log', gives: 'Trades including traded picks', perSeason: true },
  { kind: 'keepers', label: 'Keepers', path: 'This year\'s keeper list', gives: 'Keepers for the coming draft' },
  { kind: 'pick_ownership', label: 'Traded picks', path: 'Any list of future picks and who owns them', gives: 'Who owns which future pick' },
];

/** Every platform can also send its own awards list; it is added to each guide once. */
const AWARDS: GuideRow = { kind: 'awards', label: 'Your league\'s own awards', path: 'Wherever you keep them: a spreadsheet, a group chat, a photo of the list', gives: 'Your awards, under your names, ready to keep handing out' };

export const PAGE_GUIDE: Record<ImportPlatform, GuideRow[]> = {
  yahoo: [...YAHOO, AWARDS],
  espn: [...ESPN, AWARDS],
  fantrax: [...FANTRAX, AWARDS],
  cbs: [...CBS, AWARDS],
  sleeper: [...SLEEPER, AWARDS],
  manual: ANYWHERE,
};

/** The platform's own name for a page kind, for the review screen's card headers. */
export function pageNameFor(platform: ImportPlatform, kind: PageKind): string | null {
  return PAGE_GUIDE[platform]?.find((r) => r.kind === kind)?.label ?? null;
}
