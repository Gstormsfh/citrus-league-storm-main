/**
 * Trade rows arrive one asset each (a player, or a pick); the room shows
 * one line per trade with what each side received.
 */
import type { SeasonTransaction } from '@/api/imports';
import { seasonLabel } from './trophyLabels';

/** Trades arrive one asset per row; the room shows one line per trade. */
export function groupTrades(rows: SeasonTransaction[]): Array<{ key: string; date: string | null; sides: Array<{ memberId: string | null; assets: string[] }> }> {
  const byKey = new Map<string, { key: string; date: string | null; sides: Map<string, string[]> }>();
  for (const r of rows.filter((r) => r.type === 'trade')) {
    const pair = [r.member_id ?? '', r.counterparty_member_id ?? ''].sort().join('|');
    const key = `${r.occurred_at ?? 'undated'}|${pair}`;
    const g = byKey.get(key) ?? { key, date: r.occurred_at, sides: new Map<string, string[]>() };
    const asset = r.pick_round != null ? `${seasonLabel(r.pick_season ?? 0)} round ${r.pick_round} pick` : r.external_player_name ?? 'a player';
    const side = g.sides.get(r.member_id ?? '') ?? [];
    side.push(asset);
    g.sides.set(r.member_id ?? '', side);
    byKey.set(key, g);
  }
  return [...byKey.values()].map((g) => ({ key: g.key, date: g.date, sides: [...g.sides.entries()].map(([memberId, assets]) => ({ memberId: memberId || null, assets })) }));
}

