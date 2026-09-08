/**
 * ACCOMPLISHMENTS (2026-09-09, feedback item #13).
 *
 * The Trophies tab drew `[]` for everyone. These are derived from figures the
 * Profile page already holds, so nothing new is read and nothing is invented:
 * a line appears only when the number behind it is on record. Ordered from
 * the rarest to the most common so the top of the list is the one to show.
 */
export interface Accomplishment {
  key: string;
  title: string;
  description: string;
  /** Season or year it applies to, when there is one. */
  year?: string;
  tone: 'gold' | 'silver' | 'orange' | 'sage';
}

export interface AccomplishmentInput {
  championships: number;
  playoffAppearances: number;
  wins: number;
  losses: number;
  ties: number;
  currentRank: number | null;
  totalSeasons: number;
  memberSince: number;
  /** Leagues the viewer belongs to, with their draft state. */
  leagues: Array<{ draft_status?: string | null }>;
  commissionerLeagueCount: number;
  /** The launch season: everyone from that year is a founding manager. */
  launchYear?: number;
}

export function deriveAccomplishments(i: AccomplishmentInput): Accomplishment[] {
  const out: Accomplishment[] = [];
  const games = i.wins + i.losses + i.ties;
  const drafted = i.leagues.filter((l) => l.draft_status === 'completed').length;
  const launchYear = i.launchYear ?? 2026;

  if (i.championships > 0) {
    out.push({
      key: 'champion',
      title: i.championships === 1 ? 'League champion' : `${i.championships}× league champion`,
      description: 'Won the whole thing. The banner hangs here.',
      tone: 'gold',
    });
  }
  if (i.playoffAppearances > 0) {
    out.push({
      key: 'playoffs',
      title: i.playoffAppearances === 1 ? 'Playoff team' : `${i.playoffAppearances} playoff runs`,
      description: 'Made the postseason cut.',
      tone: 'silver',
    });
  }
  if (i.currentRank !== null && i.currentRank <= 3 && games > 0) {
    out.push({
      key: 'podium',
      title: i.currentRank === 1 ? 'Top of the table' : `Sitting ${i.currentRank === 2 ? 'second' : 'third'}`,
      description: 'In the top three of the active league right now.',
      tone: 'silver',
    });
  }
  if (i.wins >= 10) {
    out.push({ key: 'wins10', title: `${i.wins} wins`, description: 'Double digits in the win column.', tone: 'orange' });
  } else if (i.wins >= 1) {
    out.push({ key: 'firstwin', title: 'First win', description: 'The first one is the hardest.', tone: 'orange' });
  }
  if (games >= 5 && i.wins > i.losses) {
    out.push({
      key: 'winning',
      title: 'Winning record',
      description: `${i.wins}-${i.losses}${i.ties ? `-${i.ties}` : ''} across ${games} matchups.`,
      tone: 'orange',
    });
  }
  if (drafted > 0) {
    out.push({
      key: 'drafted',
      title: drafted === 1 ? 'Draft day' : `${drafted} drafts completed`,
      description: 'Sat through the clock and built a roster from nothing.',
      tone: 'sage',
    });
  }
  if (i.commissionerLeagueCount > 0) {
    out.push({
      key: 'commissioner',
      title: i.commissionerLeagueCount === 1 ? 'Commissioner' : `Commissioner of ${i.commissionerLeagueCount} leagues`,
      description: 'Runs the league: the settings, the draft, the arguments.',
      tone: 'sage',
    });
  }
  if (i.totalSeasons >= 2) {
    out.push({ key: 'seasons', title: `${i.totalSeasons} seasons`, description: 'Came back for more.', tone: 'sage' });
  }
  if (i.memberSince <= launchYear) {
    out.push({
      key: 'founding',
      title: 'Founding manager',
      description: 'Here from the first season of Citrus.',
      year: String(i.memberSince),
      tone: 'sage',
    });
  }
  return out;
}
