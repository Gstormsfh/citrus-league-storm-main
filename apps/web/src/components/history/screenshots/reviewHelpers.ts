/**
 * Pure helpers for the review screen, kept out of the component file so
 * fast refresh sees one component per module.
 */
import type { PageKind, ScreenshotPage } from '@/api/imports';

export const KIND_LABEL: Record<PageKind, string> = {
  champions: 'League history (champions by season)', awards: 'League awards',
  standings: 'Standings', playoffs: 'Playoffs', draft: 'Draft results', transactions: 'Transactions', keepers: 'Keepers',
  roster: 'Rosters', pick_ownership: 'Traded draft picks', settings: 'League settings', scoreboard: 'Weekly scoreboard', other: 'Not a league page',
};

/** Rows without their one required name are dropped rather than refused by the server. */
export function tidyPages(pages: ScreenshotPage[]): ScreenshotPage[] {
  return pages.filter((p) => p.kind !== 'other').map((p) => ({
    ...p,
    champions: p.champions?.filter((r) => r.championTeam?.trim() && r.season != null) ?? null,
    awards: p.awards?.filter((r) => r.award?.trim()) ?? null,
    standings: p.standings?.filter((r) => r.teamName?.trim()) ?? null,
    playoffs: p.playoffs?.filter((r) => r.homeTeam?.trim()) ?? null,
    picks: p.picks?.filter((r) => r.teamName?.trim() && r.playerName?.trim()) ?? null,
    transactions: p.transactions?.filter((r) => r.teamName?.trim()) ?? null,
    keepers: p.keepers?.filter((r) => r.teamName?.trim() && r.playerName?.trim()) ?? null,
    pickOwnership: p.pickOwnership?.filter((r) => r.originalTeamName?.trim() && r.ownerTeamName?.trim() && r.draftSeason != null && r.round != null) ?? null,
  }));
}

/** Champions and awards pages carry their seasons row by row, not on the page. */
export const ROW_SEASON_KINDS: PageKind[] = ['champions', 'awards'];
/** Pages that describe the league as it stands and attach to the newest season without one of their own. */
export const SEASONLESS_KINDS: PageKind[] = ['settings', 'keepers', 'roster', 'pick_ownership', ...ROW_SEASON_KINDS];

export function seasonsIn(pages: ScreenshotPage[]): number[] {
  const out = new Set<number>();
  for (const p of pages) {
    if (p.kind === 'other') continue;
    if (p.kind === 'champions') { for (const r of p.champions ?? []) if (r.season != null) out.add(r.season); continue; }
    if (p.kind === 'awards') { for (const r of p.awards ?? []) if (r.season != null) out.add(r.season); continue; }
    if (p.season != null) out.add(p.season);
  }
  return [...out].sort((a, b) => a - b);
}

