import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';

export const DRAFT_KIT_PRODUCT = 'draft-kit-2026-27';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The checkout-owned entitlement is the only paid delivery authority.
 * Always use the caller's JWT client. No payment return URL, local backup,
 * browser tier, old PDF ledger or service-role read can unlock a download.
 */
export class DraftKitAccessService {
  constructor(private db: SupabaseClient) {}

  async access(userId: string) {
    if (!UUID.test(userId)) throw AppError.unauthorized();
    const now = new Date().toISOString();
    const { data, error } = await this.db.from('draft_kit_entitlements')
      .select('user_id,tier,granted_at,expires_at').eq('user_id', userId)
      .in('tier', ['kit', 'suite']).lte('granted_at', now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('expires_at', { ascending: false, nullsFirst: true }).limit(1).maybeSingle();
    if (error) throw AppError.serviceUnavailable('Could not verify draft-kit access. Please retry.');
    if (!data) return { active: false, accessUntil: null };
    const start = Date.parse(data.granted_at);
    const end = data.expires_at === null ? Infinity : Date.parse(data.expires_at);
    if (data.user_id !== userId || !['kit', 'suite'].includes(data.tier)
      || !Number.isFinite(start) || start > Date.parse(now) || !(end > Date.parse(now)))
      throw AppError.serviceUnavailable('Draft-kit access could not be verified. Please retry.');
    return { active: true, accessUntil: data.expires_at as string | null };
  }
}
