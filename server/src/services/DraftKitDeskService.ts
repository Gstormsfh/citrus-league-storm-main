import type { SupabaseClient } from '@supabase/supabase-js';
import { projectionSettings } from '@citrus/shared';
import { AppError } from '../lib/errors';
import { DraftKitAccessService, DRAFT_KIT_PRODUCT as PDF_PRODUCT } from './DraftKitAccessService';
import { PublishedDraftDeskService, DESK_SUPPORTED_WEIGHTS } from './PublishedDraftDeskService';
import { LeagueMembershipService } from './LeagueMembershipService';

type Weights = Record<string, Record<string, number>>;
export type DeskNote = { player_key: string; note: string; target: boolean; version: number };

export function roomDeskWeights(raw: unknown, supported: Weights, settings: Record<string, unknown> | null): Weights {
  const format = settings?.scoringFormat ?? settings?.scoringType ?? 'h2h-points';
  if (!['h2h-points', 'total-points', 'best-ball'].includes(String(format)))
    throw AppError.badRequest('This draft-kit edition supports total fantasy points, not category or per-game rankings.');
  if (raw != null) {
    if (typeof raw !== 'object' || Array.isArray(raw)) throw AppError.badRequest('Your league scoring needs to be checked.');
    for (const [group, stats] of Object.entries(raw)) {
      if (!['skater', 'goalie'].includes(group) || !stats || typeof stats !== 'object' || Array.isArray(stats))
        throw AppError.badRequest('Your league scoring needs to be checked.');
      for (const value of Object.values(stats)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10000)
          throw AppError.badRequest('Your league scoring needs to be checked.');
      }
    }
  }
  const normalized = projectionSettings(raw) as unknown as Weights;
  const result: Weights = {};
  for (const group of ['skater', 'goalie']) {
    for (const [stat, weight] of Object.entries(normalized[group])) {
      if (weight !== 0 && !(stat in supported[group]))
        throw AppError.badRequest(`This edition does not project ${stat.replace(/_/g, ' ')}. Your league rankings cannot be matched safely.`);
    }
    result[group] = Object.fromEntries(Object.keys(supported[group]).map(stat => [stat, normalized[group][stat] ?? 0]));
  }
  return result;
}

export class DraftKitDeskService {
  constructor(private db: SupabaseClient, private publisher = new PublishedDraftDeskService(db)) {}

  private async league(userId: string, leagueId: string) {
    if (!(await new LeagueMembershipService(this.db).checkMembership(leagueId, userId)).isMember)
      throw AppError.forbidden('Join this league to open its draft desk.');
    const { data, error } = await this.db.from('leagues').select('name,scoring_settings,settings,commissioner_id').eq('id', leagueId).single();
    if (error || !data) throw AppError.serviceUnavailable('Could not verify your league. Please retry.');
    // Membership cache is useful for routing, but paid delivery needs a fresh check.
    if (data.commissioner_id !== userId) {
      const member = await this.db.from('teams').select('id').eq('league_id', leagueId).eq('owner_id', userId).limit(1).maybeSingle();
      if (member.error) throw AppError.serviceUnavailable('Could not verify your league membership.');
      if (!member.data) throw AppError.forbidden('You no longer belong to this league.');
    }
    return data;
  }

  async open(userId: string, leagueId: string) {
    const league = await this.league(userId, leagueId);
    const purchase = new DraftKitAccessService(this.db);
    if (!(await purchase.access(userId)).active) return { owned: false as const };
    const weights = roomDeskWeights(league.scoring_settings, DESK_SUPPORTED_WEIGHTS, league.settings);
    const name = String(league.name || 'My Citrus league').trim().slice(0, 64);
    const { kit, warning } = await this.publisher.connected(name, weights);
    const notes = await this.db.from('draft_kit_desk_notes').select('player_key,note,target,version')
      .eq('user_id', userId).eq('league_id', leagueId).eq('product', PDF_PRODUCT);
    if (notes.error) throw AppError.serviceUnavailable('Could not load your saved draft notes. Please retry.');
    const currentLeague = await this.league(userId, leagueId);
    const currentWeights = roomDeskWeights(currentLeague.scoring_settings, DESK_SUPPORTED_WEIGHTS, currentLeague.settings);
    if (JSON.stringify(currentWeights) !== JSON.stringify(weights))
      throw AppError.conflict('Your league scoring changed while the board was loading. Please retry to use the updated scoring.');
    if (!(await purchase.access(userId)).active) throw AppError.forbidden('Your draft-kit access has changed.');
    const validKeys = new Set(kit.players.map(p => p.key));
    const rows = (notes.data as DeskNote[]).filter(n => validKeys.has(n.player_key));
    return { owned: true as const, warning, file: { kind: 'citrus-connected-desk', version: 1, kit,
      progress: { version: 1, fingerprint: kit.fingerprint,
        rows: rows.map(n => ({ key: n.player_key, note: n.note, target: n.target, drafted: false })) } },
      versions: Object.fromEntries(rows.map(n => [n.player_key, n.version])) };
  }

  async save(userId: string, leagueId: string, key: string, change: { note: string; target: boolean; version: number | null }) {
    await this.league(userId, leagueId);
    if (!(await new DraftKitAccessService(this.db).access(userId)).active)
      throw AppError.forbidden('Your draft-kit access has changed. Your note has not been saved.');
    const values = { note: change.note, target: change.target, version: (change.version ?? 0) + 1, updated_at: new Date().toISOString() };
    const query = change.version === null
      ? this.db.from('draft_kit_desk_notes').insert({ ...values, user_id: userId, league_id: leagueId, product: PDF_PRODUCT, player_key: key })
      : this.db.from('draft_kit_desk_notes').update(values).eq('user_id', userId).eq('league_id', leagueId)
        .eq('product', PDF_PRODUCT).eq('player_key', key).eq('version', change.version);
    const { data, error } = await query.select('version,note,target').maybeSingle();
    if (error?.code === '23505' || (!error && !data)) {
      // A successful save can lose its HTTP response. Accept only an exact
      // replay of the next version, never overwrite a different tab's work.
      const current = await this.db.from('draft_kit_desk_notes').select('version,note,target')
        .eq('user_id', userId).eq('league_id', leagueId).eq('product', PDF_PRODUCT).eq('player_key', key).maybeSingle();
      if (!current.error && current.data?.version === values.version && current.data.note === change.note && current.data.target === change.target)
        return current.data as { version: number; note: string; target: boolean };
      throw AppError.conflict('This player was changed in another tab. Save a backup, then reload to see the saved version.');
    }
    if (error) throw AppError.serviceUnavailable('Your note has not been saved. Please retry.');
    return data as { version: number; note: string; target: boolean };
  }
}
