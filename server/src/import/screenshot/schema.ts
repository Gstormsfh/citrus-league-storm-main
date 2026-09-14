/**
 * What a league page screenshot can say, as a schema.
 *
 * One `ExtractedPage` per image. The vision model fills it through a tool
 * call whose input schema is JSON_SCHEMA below, so the model cannot answer
 * in prose; then zod re-validates the tool input, because a tool schema is
 * a request, not a guarantee. The same zod schema validates the payload the
 * commissioner sends back after editing, so a hand-edited cell goes through
 * exactly the checks a model-read one did.
 *
 * Everything is optional and nullable on purpose: a Yahoo standings page has
 * no points-for column in a category league, a CBS draft page has no
 * positions, a phone crop cuts a column off. The assembler (assemble.ts)
 * decides what a missing field means; here it is simply null.
 *
 * Numbers are numbers, never strings, so "1,234.5" is 1234.5 by the time it
 * is here. Seasons are START years (2024 means 2024-25). A page whose season
 * the model cannot see carries null and the commissioner sets it.
 */
import { z } from 'zod';

export const PAGE_KINDS = ['champions', 'awards', 'standings', 'playoffs', 'draft', 'transactions', 'keepers', 'roster', 'pick_ownership', 'settings', 'scoreboard', 'other'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const PAGE_PLATFORMS = ['yahoo', 'espn', 'fantrax', 'cbs', 'sleeper', 'unknown'] as const;

const nullableNum = z.number().finite().nullable().optional();
const nullableInt = z.number().int().nullable().optional();
const nullableStr = z.string().max(200).nullable().optional();
const nullableBool = z.boolean().nullable().optional();

/** One past season on a league history page: who won, and who lost the final where shown. */
export const championRowSchema = z.object({
  /** START year of that season. */
  season: z.number().int().min(1990).max(2100),
  championTeam: z.string().min(1).max(120),
  championManager: nullableStr,
  runnerUpTeam: nullableStr,
  runnerUpManager: nullableStr,
  /** Anything else the row printed: a score, a record, a note. */
  note: nullableStr,
});

/** One of the league's own honours: the award as the league names it, who won it, which season. */
export const awardRowSchema = z.object({
  /** START year, or null for an all-time award. */
  season: z.number().int().min(1990).max(2100).nullable().optional(),
  award: z.string().min(1).max(80),
  winnerTeam: nullableStr,
  winnerManager: nullableStr,
  note: nullableStr,
});

export const standingsRowSchema = z.object({
  rank: nullableInt,
  teamName: z.string().min(1).max(120),
  managerName: nullableStr,
  wins: nullableInt,
  losses: nullableInt,
  ties: nullableInt,
  pointsFor: nullableNum,
  pointsAgainst: nullableNum,
  /** Verbatim category record when the platform shows one, e.g. "132-69-9". */
  categoryRecord: nullableStr,
  playoffSeed: nullableInt,
  /** 1 won the final, 2 lost the final, 3 third place, when the page says. */
  playoffFinish: nullableInt,
  madePlayoffs: nullableBool,
  isChampion: nullableBool,
});

export const playoffMatchupSchema = z.object({
  round: z.enum(['final', 'third_place', 'semifinal', 'quarterfinal', 'consolation', 'other']),
  week: nullableInt,
  homeTeam: z.string().min(1).max(120),
  awayTeam: z.string().max(120).nullable().optional(),
  homeScore: nullableNum,
  awayScore: nullableNum,
  winner: z.enum(['home', 'away', 'tie']).nullable().optional(),
});

export const draftPickSchema = z.object({
  overall: nullableInt,
  round: nullableInt,
  pickInRound: nullableInt,
  teamName: z.string().min(1).max(120),
  playerName: z.string().min(1).max(120),
  playerTeamAbbr: nullableStr,
  position: nullableStr,
  isKeeper: nullableBool,
  keeperCost: nullableStr,
  auctionCost: nullableNum,
});

export const transactionRowSchema = z.object({
  /** ISO date when readable, else the text as shown. */
  date: nullableStr,
  type: z.enum(['add', 'drop', 'trade', 'waiver', 'commish', 'keeper', 'unknown']),
  teamName: z.string().min(1).max(120),
  counterpartyTeamName: nullableStr,
  playerName: nullableStr,
  playerTeamAbbr: nullableStr,
  position: nullableStr,
  /** A traded draft pick as the asset, instead of a player. */
  pickSeason: nullableInt,
  pickRound: nullableInt,
  pickOriginalTeamName: nullableStr,
  faabBid: nullableNum,
});

export const keeperRowSchema = z.object({
  teamName: z.string().min(1).max(120),
  playerName: z.string().min(1).max(120),
  playerTeamAbbr: nullableStr,
  position: nullableStr,
  /** Round the keeper costs in the coming draft, when shown. */
  round: nullableInt,
  roundNext: nullableInt,
  yearsKept: nullableInt,
});

export const rosterRowSchema = z.object({
  teamName: z.string().min(1).max(120),
  players: z.array(z.object({ playerName: z.string().min(1).max(120), playerTeamAbbr: nullableStr, position: nullableStr })).max(60),
});

export const pickOwnershipRowSchema = z.object({
  /** START year of the season whose draft the pick belongs to. */
  draftSeason: z.number().int(),
  round: z.number().int().min(1).max(60),
  originalTeamName: z.string().min(1).max(120),
  ownerTeamName: z.string().min(1).max(120),
});

export const settingsSchema = z.object({
  scoringType: z.enum(['points', 'h2h_points', 'h2h_categories', 'h2h_one_win', 'roto', 'unknown']).nullable().optional(),
  /** Category names as shown, e.g. ["G","A","+/-","PIM","PPP","SOG","W","GAA","SV%"]. */
  categories: z.array(z.string().max(60)).max(60).nullable().optional(),
  /** Points leagues: one entry per scored stat. */
  pointValues: z.array(z.object({ stat: z.string().max(60), points: z.number().finite() })).max(80).nullable().optional(),
  rosterSlots: z.array(z.object({ slot: z.string().max(20), count: z.number().int().min(0).max(30) })).max(30).nullable().optional(),
  keeperCount: nullableInt,
  keeperRule: nullableStr,
  draftType: nullableStr,
  usesFaab: nullableBool,
  regularSeasonWeeks: nullableInt,
  playoffTeams: nullableInt,
  playoffWeeks: nullableInt,
  teamCount: nullableInt,
});

export const scoreboardSchema = z.object({
  week: z.number().int().min(1).max(40),
  isPlayoff: nullableBool,
  matchups: z.array(z.object({
    homeTeam: z.string().min(1).max(120),
    awayTeam: z.string().max(120).nullable().optional(),
    homeScore: nullableNum,
    awayScore: nullableNum,
    homeCatWins: nullableInt,
    homeCatLosses: nullableInt,
    homeCatTies: nullableInt,
    winner: z.enum(['home', 'away', 'tie']).nullable().optional(),
  })).max(20),
});

export const extractedPageSchema = z.object({
  /** Position of the image in the upload, 0-based. */
  index: z.number().int().min(0),
  platform: z.enum(PAGE_PLATFORMS),
  kind: z.enum(PAGE_KINDS),
  /** START year, or null when the page does not show it. */
  season: z.number().int().min(1990).max(2100).nullable(),
  leagueName: nullableStr,
  confidence: z.enum(['high', 'medium', 'low']),
  /** Anything the reader wants the commissioner to check. */
  notes: z.string().max(600).nullable().optional(),
  champions: z.array(championRowSchema).max(60).nullable().optional(),
  awards: z.array(awardRowSchema).max(200).nullable().optional(),
  standings: z.array(standingsRowSchema).max(40).nullable().optional(),
  playoffs: z.array(playoffMatchupSchema).max(40).nullable().optional(),
  picks: z.array(draftPickSchema).max(600).nullable().optional(),
  transactions: z.array(transactionRowSchema).max(400).nullable().optional(),
  keepers: z.array(keeperRowSchema).max(400).nullable().optional(),
  roster: z.array(rosterRowSchema).max(40).nullable().optional(),
  pickOwnership: z.array(pickOwnershipRowSchema).max(400).nullable().optional(),
  settings: settingsSchema.nullable().optional(),
  scoreboard: scoreboardSchema.nullable().optional(),
});

export type ExtractedPage = z.infer<typeof extractedPageSchema>;
export type StandingsRow = z.infer<typeof standingsRowSchema>;
export type ChampionRow = z.infer<typeof championRowSchema>;
export type AwardRow = z.infer<typeof awardRowSchema>;
export type DraftPickRow = z.infer<typeof draftPickSchema>;
export type TransactionRow = z.infer<typeof transactionRowSchema>;
export type KeeperRow = z.infer<typeof keeperRowSchema>;
export type PickOwnershipRow = z.infer<typeof pickOwnershipRowSchema>;
export type ExtractedSettings = z.infer<typeof settingsSchema>;

export const extractionSchema = z.object({ pages: z.array(extractedPageSchema).max(40) });
export type Extraction = z.infer<typeof extractionSchema>;

/**
 * The tool input schema handed to the model. Kept by hand rather than
 * generated so the descriptions read as instructions to a reader, which is
 * what moves accuracy on a phone screenshot with a cut-off column.
 */
const num = (description: string) => ({ type: ['number', 'null'], description });
const int = (description: string) => ({ type: ['integer', 'null'], description });
const str = (description: string) => ({ type: ['string', 'null'], description });
const bool = (description: string) => ({ type: ['boolean', 'null'], description });
const team = { type: 'string', description: 'Team name exactly as printed, including emoji and punctuation.' };

export const JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['pages'],
  properties: {
    pages: {
      type: 'array',
      description: 'One entry per image, in the order the images were given.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'platform', 'kind', 'season', 'leagueName', 'confidence'],
        properties: {
          index: { type: 'integer', description: '0-based position of the image.' },
          platform: { type: 'string', enum: [...PAGE_PLATFORMS], description: 'The fantasy platform the page is from, judged from its design and wording.' },
          kind: { type: 'string', enum: [...PAGE_KINDS], description: 'champions: a league history page listing past seasons with each season\'s champion (one row per season, several seasons on one page). awards: the league\'s own honours by season and winner (a list or spreadsheet of trophies the league hands out itself). standings: a ranked table of teams with records. playoffs: a bracket or playoff results. draft: draft results, picks in order. transactions: adds, drops, trades. keepers: a list of players teams are keeping with their cost. roster: one or more full team rosters. pick_ownership: a table of future draft picks and who owns them. settings: league scoring or roster rules. scoreboard: one week of matchups with scores. other: not a fantasy league page.' },
          season: int('START year of the NHL season the page is about: 2024 for 2024-25. Read it from the page (a year in the header, "2024-25", a "2024 Fantasy Hockey" title). Null if the page does not show a season.'),
          leagueName: str('The league name if printed.'),
          confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'low when text is cut off, blurred, or a column could not be told apart.' },
          notes: str('Anything the commissioner should check: a cut-off column, a guessed season, a team name that may be truncated.'),
          champions: {
            type: ['array', 'null'],
            description: 'Only for kind champions. One entry per past season on the page. The page season field stays null for this kind; each row carries its own.',
            items: {
              type: 'object', additionalProperties: false, required: ['season', 'championTeam'],
              properties: {
                season: { type: 'integer', description: 'START year of that season: "2019-20" is 2019; an ESPN "2020" is 2019.' },
                championTeam: { type: 'string', description: 'The champion team name as printed.' },
                championManager: str('The champion manager name, if printed.'),
                runnerUpTeam: str('The team that lost the final, if printed.'),
                runnerUpManager: str('That manager, if printed.'),
                note: str('Anything else printed on the row: the final score, a record.'),
              },
            },
          },
          awards: {
            type: ['array', 'null'],
            description: 'Only for kind awards. One entry per award per season as listed.',
            items: {
              type: 'object', additionalProperties: false, required: ['award'],
              properties: {
                season: int('START year the award was for, or null when the list does not say or the award is all-time.'),
                award: { type: 'string', description: 'The award name exactly as the league writes it.' },
                winnerTeam: str('The winning team name, if that is what is listed.'),
                winnerManager: str('The winning manager name, if that is what is listed.'),
                note: str('Anything printed beside it: a stat, a reason, a joke.'),
              },
            },
          },
          standings: {
            type: ['array', 'null'],
            description: 'Only for kind standings. Every team row, in the order shown.',
            items: {
              type: 'object', additionalProperties: false, required: ['teamName'],
              properties: {
                rank: int('Rank as printed. Final standings after playoffs when the page says so.'),
                teamName: team,
                managerName: str('The manager or owner name shown beside the team, exactly as printed.'),
                wins: int('Wins.'), losses: int('Losses.'), ties: int('Ties, or null if the page has no tie column.'),
                pointsFor: num('Points for / fantasy points scored, with the thousands separator removed.'),
                pointsAgainst: num('Points against.'),
                categoryRecord: str('A category league record like "132-69-9", verbatim, when the record counts categories rather than weeks.'),
                playoffSeed: int('Playoff seed if shown.'),
                playoffFinish: int('1 for the champion, 2 for the finalist who lost, 3 for third place, when the page marks it.'),
                madePlayoffs: bool('True when the page marks the team as a playoff team (a trophy, an x, a "clinched" mark).'),
                isChampion: bool('True only when the page marks this team as the champion.'),
              },
            },
          },
          playoffs: {
            type: ['array', 'null'],
            description: 'Only for kind playoffs. One entry per matchup in the bracket.',
            items: {
              type: 'object', additionalProperties: false, required: ['round', 'homeTeam'],
              properties: {
                round: { type: 'string', enum: ['final', 'third_place', 'semifinal', 'quarterfinal', 'consolation', 'other'] },
                week: int('Fantasy week number of the matchup, if shown.'),
                homeTeam: team, awayTeam: str('The other team; null for a bye.'),
                homeScore: num('Score of homeTeam.'), awayScore: num('Score of awayTeam.'),
                winner: { type: ['string', 'null'], enum: ['home', 'away', 'tie', null], description: 'Who advanced or won.' },
              },
            },
          },
          picks: {
            type: ['array', 'null'],
            description: 'Only for kind draft. Every pick visible, in draft order.',
            items: {
              type: 'object', additionalProperties: false, required: ['teamName', 'playerName'],
              properties: {
                overall: int('Overall pick number, if shown.'), round: int('Round.'), pickInRound: int('Pick within the round, if shown.'),
                teamName: team, playerName: { type: 'string', description: 'Player name as printed, without the NHL team or position.' },
                playerTeamAbbr: str('NHL team abbreviation printed beside the player, e.g. EDM.'),
                position: str('Position printed beside the player, e.g. C, LW, D, G.'),
                isKeeper: bool('True when the pick is marked as a keeper.'),
                keeperCost: str('The keeper cost text if shown, e.g. "Round 3".'),
                auctionCost: num('Auction price if this was an auction draft.'),
              },
            },
          },
          transactions: {
            type: ['array', 'null'],
            description: 'Only for kind transactions. One entry per asset moved: a trade of two players for one pick is three entries with the same date and teams.',
            items: {
              type: 'object', additionalProperties: false, required: ['type', 'teamName'],
              properties: {
                date: str('Date as ISO (2024-11-03) when readable, else as printed.'),
                type: { type: 'string', enum: ['add', 'drop', 'trade', 'waiver', 'commish', 'keeper', 'unknown'] },
                teamName: { type: 'string', description: 'The team receiving the asset (for a drop, the team dropping it).' },
                counterpartyTeamName: str('For a trade, the team giving the asset.'),
                playerName: str('The player moved, or null when the asset is a draft pick.'),
                playerTeamAbbr: str('NHL team abbreviation beside the player.'), position: str('Position beside the player.'),
                pickSeason: int('For a traded draft pick: the START year of the draft it belongs to (a "2026 2nd round pick" in an NHL league is season 2026).'),
                pickRound: int('For a traded draft pick: the round.'),
                pickOriginalTeamName: str('For a traded draft pick: whose pick it originally was, if the page says.'),
                faabBid: num('Winning FAAB bid for a waiver claim, if shown.'),
              },
            },
          },
          keepers: {
            type: ['array', 'null'],
            description: 'Only for kind keepers. Every kept player visible.',
            items: {
              type: 'object', additionalProperties: false, required: ['teamName', 'playerName'],
              properties: {
                teamName: team, playerName: { type: 'string' },
                playerTeamAbbr: str('NHL team abbreviation.'), position: str('Position.'),
                round: int('The round the keeper costs in the coming draft, if shown.'),
                roundNext: int('The round it would cost the season after, if shown.'),
                yearsKept: int('How many seasons in a row the player has been kept, if shown.'),
              },
            },
          },
          roster: {
            type: ['array', 'null'],
            description: 'Only for kind roster. One entry per team shown, with every player on it.',
            items: {
              type: 'object', additionalProperties: false, required: ['teamName', 'players'],
              properties: {
                teamName: team,
                players: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['playerName'], properties: { playerName: { type: 'string' }, playerTeamAbbr: str('NHL team abbreviation.'), position: str('Position.') } } },
              },
            },
          },
          pickOwnership: {
            type: ['array', 'null'],
            description: 'Only for kind pick_ownership. One entry per future pick that is owned by a team other than the one it originally belonged to. Skip picks a team still owns itself.',
            items: {
              type: 'object', additionalProperties: false, required: ['draftSeason', 'round', 'originalTeamName', 'ownerTeamName'],
              properties: {
                draftSeason: { type: 'integer', description: 'START year of the season whose draft the pick is in.' },
                round: { type: 'integer' },
                originalTeamName: { type: 'string', description: 'The team whose slot it originally was.' },
                ownerTeamName: { type: 'string', description: 'The team that owns it now.' },
              },
            },
          },
          settings: {
            type: ['object', 'null'],
            description: 'Only for kind settings.',
            additionalProperties: false,
            properties: {
              scoringType: { type: ['string', 'null'], enum: ['points', 'h2h_points', 'h2h_categories', 'h2h_one_win', 'roto', 'unknown', null] },
              categories: { type: ['array', 'null'], items: { type: 'string' }, description: 'Category abbreviations as printed, for a categories or roto league.' },
              pointValues: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['stat', 'points'], properties: { stat: { type: 'string' }, points: { type: 'number' } } }, description: 'Points per stat for a points league.' },
              rosterSlots: { type: ['array', 'null'], items: { type: 'object', additionalProperties: false, required: ['slot', 'count'], properties: { slot: { type: 'string' }, count: { type: 'integer' } } } },
              keeperCount: int('Keepers allowed per team.'), keeperRule: str('The keeper cost rule as printed.'),
              draftType: str('snake, linear, auction, or as printed.'), usesFaab: bool('True when waivers use a FAAB budget.'),
              regularSeasonWeeks: int('Regular season length in weeks.'), playoffTeams: int('Teams that make the playoffs.'), playoffWeeks: int('Playoff length in weeks.'),
              teamCount: int('Teams in the league.'),
            },
          },
          scoreboard: {
            type: ['object', 'null'],
            description: 'Only for kind scoreboard: one fantasy week.',
            additionalProperties: false,
            required: ['week', 'matchups'],
            properties: {
              week: { type: 'integer' },
              isPlayoff: bool('True when the page marks the week as a playoff week.'),
              matchups: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['homeTeam'],
                  properties: {
                    homeTeam: team, awayTeam: str('The other team; null for a bye.'),
                    homeScore: num('Points for homeTeam in a points league.'), awayScore: num('Points for awayTeam.'),
                    homeCatWins: int('Category wins for homeTeam in a categories league.'), homeCatLosses: int('Category losses for homeTeam.'), homeCatTies: int('Category ties.'),
                    winner: { type: ['string', 'null'], enum: ['home', 'away', 'tie', null] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
