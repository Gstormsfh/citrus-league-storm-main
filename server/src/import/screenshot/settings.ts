/**
 * A settings page, as printed, into ImportedSettings.
 *
 * Every platform prints stats by abbreviation and the abbreviations agree
 * far more than the ids do (G, A, PPP, SOG, W, GAA, SV%), so the Yahoo
 * name table is the lookup for every platform, with a few spellings the
 * other platforms use added here. What it cannot name is carried as
 * unknown_<platform>_<slug>, never dropped, exactly as the API parsers do.
 */
import type { ImportedRosterSlot, ImportedScoringItem, ImportedSettings, ImportPlatform } from '../types';
import { REVERSE_KEYS, YAHOO_STAT_BY_NAME, yahooSlot } from '../yahoo/maps';
import type { ExtractedSettings } from './schema';

/** Spellings seen on ESPN, Fantrax and CBS pages that the Yahoo table lacks. */
const ALIASES: Record<string, string> = {
  'GOALS': 'G', 'ASSISTS': 'A', 'POINTS': 'P', 'PLUS/MINUS': '+/-', 'PLUS MINUS': '+/-', 'PM': 'PIM', 'PENALTY MINUTES': 'PIM',
  'POWER PLAY POINTS': 'PPP', 'PP POINTS': 'PPP', 'POWER PLAY GOALS': 'PPG', 'POWER PLAY ASSISTS': 'PPA',
  'SHORT HANDED POINTS': 'SHP', 'SHORTHANDED POINTS': 'SHP', 'SH POINTS': 'SHP', 'SHORT HANDED GOALS': 'SHG',
  'GAME WINNING GOALS': 'GWG', 'SHOTS': 'SOG', 'SHOTS ON GOAL': 'SOG', 'SHOOTING %': 'SH%', 'FACEOFF WINS': 'FW', 'FACEOFFS WON': 'FW', 'FOW': 'FW',
  'FACEOFF LOSSES': 'FL', 'FACEOFFS LOST': 'FL', 'FOL': 'FL', 'HITS': 'HIT', 'H': 'HIT', 'BLOCKS': 'BLK', 'BLOCKED SHOTS': 'BLK', 'BS': 'BLK', 'B': 'BLK',
  'HAT TRICKS': 'HAT', 'WINS': 'W', 'LOSSES': 'L', 'OVERTIME LOSSES': 'OTL', 'GOALS AGAINST': 'GA', 'GOALS AGAINST AVERAGE': 'GAA',
  'SAVES': 'SV', 'SAVE %': 'SV%', 'SAVE PERCENTAGE': 'SV%', 'SVP': 'SV%', 'SHUTOUTS': 'SHO', 'SO': 'SHO', 'SHUTOUT': 'SHO',
  'GAMES STARTED': 'GS', 'STARTS': 'GS', 'GAMES PLAYED': 'GP', 'SHOTS AGAINST': 'SA', 'MINUTES': 'MIN', 'TIME ON ICE': 'TOI',
};

const GOALIE_ONLY = new Set(['W', 'L', 'OTL', 'GA', 'GAA', 'SV', 'SV%', 'SHO', 'GS', 'SA', 'MIN', 'T']);

export function resolveStatName(printed: string, platform: ImportPlatform): { sourceStatId: string; citrusKey: string; group: 'skater' | 'goalie' | 'unknown'; known: boolean } {
  const raw = printed.trim();
  const upper = raw.toUpperCase().replace(/\s+/g, ' ');
  const goalieMarked = /\bG:|^G\s|\(G\)|GOALIE/.test(upper);
  const stripped = upper.replace(/^G:\s*|^G\s+|\(G\)|GOALIE\s*/g, '').trim();
  const key = ALIASES[stripped] ?? stripped;
  const def = YAHOO_STAT_BY_NAME[key];
  if (def) {
    if (def.citrusKey === 'games_played' && goalieMarked) return { sourceStatId: raw, citrusKey: 'goalie_games_played', group: 'goalie', known: true };
    return { sourceStatId: raw, citrusKey: def.citrusKey, group: def.group, known: true };
  }
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'stat';
  return { sourceStatId: raw, citrusKey: `unknown_${platform}_${slug}`, group: goalieMarked || GOALIE_ONLY.has(key) ? 'goalie' : 'unknown', known: false };
}

export function translateSettings(page: ExtractedSettings, platform: ImportPlatform, leagueName: string): { settings: ImportedSettings; warnings: string[] } {
  const warnings: string[] = [];
  const items: ImportedScoringItem[] = [];
  const seen = new Set<string>();
  const push = (printed: string, points: number | null) => {
    const r = resolveStatName(printed, platform);
    if (seen.has(r.citrusKey)) return;
    seen.add(r.citrusKey);
    if (!r.known) warnings.push(`Stat "${printed}" is not one Citrus scores; carried as ${r.citrusKey}.`);
    items.push({ sourceStatId: r.sourceStatId, citrusKey: r.citrusKey, group: r.group, points, reverse: REVERSE_KEYS.has(r.citrusKey), enabled: true });
  };
  for (const c of page.categories ?? []) push(c, null);
  for (const pv of page.pointValues ?? []) push(pv.stat, pv.points);

  const rosterSlots: ImportedRosterSlot[] = [];
  for (const s of page.rosterSlots ?? []) {
    if (s.count <= 0) continue;
    const slot = yahooSlot(s.slot);
    const existing = rosterSlots.find((r) => r.slot === slot);
    if (existing) existing.count += s.count; else rosterSlots.push({ slot, count: s.count });
  }

  const scoringType = page.scoringType ?? (page.pointValues?.length ? 'h2h_points' : page.categories?.length ? 'h2h_categories' : 'unknown');
  const draftType = page.draftType ? page.draftType.trim().toUpperCase() : null;

  return {
    settings: {
      leagueName,
      scoringType,
      scoringItems: items,
      rosterSlots,
      regularSeasonWeeks: page.regularSeasonWeeks ?? null,
      playoffTeamCount: page.playoffTeams ?? null,
      playoffWeeks: page.playoffWeeks ?? null,
      keeperCount: page.keeperCount ?? null,
      keeperOrderType: page.keeperRule ?? null,
      draftType,
      usesFaab: page.usesFaab ?? null,
      isPublic: null,
    },
    warnings,
  };
}
