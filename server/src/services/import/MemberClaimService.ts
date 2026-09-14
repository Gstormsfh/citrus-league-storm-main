/**
 * The "which one is you?" flow and the commissioner's member tools.
 *
 * Claim and merge run inside SECURITY DEFINER functions that carry every
 * check the route would make (signed in, unclaimed row, valid token or league
 * membership, one live row per person). This service is the typed surface
 * over those RPCs plus the reads the screens need.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../lib/errors';

export interface UnclaimedMember {
  id: string; display_name: string; first_season: number | null; last_season: number | null;
  titles: number; seasons_played: number; playoff_seasons: number; best_finish: number | null;
}

export interface ClaimResult { member_id: string; league_id: string; display_name: string; claim_method: string }

/**
 * The "which one is you?" answer for one person in one league.
 *
 * `attached` is true once the caller's own member row has been claimed:
 * claimed_at is stamped by the claim function, the commissioner's assign,
 * the merge a claim performs into an existing row, and the importer's own
 * OAuth match. It is NOT "has an owner": the foundation seed gave every
 * current team owner a row with no history and no claimed_at, so owner_id
 * alone would tell every member they are done before they have started. The
 * screens ask the question only while `attached` is false and `members` is
 * non-empty. Read from league_members, which a team owner can select under
 * RLS; the identities table is commissioner-only and stays that way.
 */
export interface ClaimQuestion { members: UnclaimedMember[]; attached: boolean }

const HONOURS_COLUMNS = 'member_id, display_name, owner_id, first_season, last_season, seasons_played, titles, playoff_seasons, best_finish';

export class MemberClaimService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Members with history and no account attached, with the one-line career
   * that helps a person spot themselves, and whether the caller still needs
   * to be asked. Merged rows keep their league_members row for provenance;
   * the honours view carries merged_into_member_id so they are filtered here
   * and never shown as a ghost "Unclaimed" manager.
   */
  async listUnclaimed(leagueId: string, userId: string): Promise<ClaimQuestion> {
    const { data, error } = await this.supabase
      .from('league_member_honours')
      .select(HONOURS_COLUMNS)
      .eq('league_id', leagueId)
      .is('owner_id', null)
      .is('merged_into_member_id', null)
      .order('display_name', { ascending: true });
    if (error) throw new Error(`league_member_honours read failed: ${error.message}`);
    const members = ((data ?? []) as Array<UnclaimedMember & { member_id: string; owner_id: string | null }>)
      .map((r) => ({
        id: r.member_id, display_name: r.display_name, first_season: r.first_season, last_season: r.last_season,
        titles: Number(r.titles ?? 0), seasons_played: Number(r.seasons_played ?? 0), playoff_seasons: Number(r.playoff_seasons ?? 0), best_finish: r.best_finish,
      }));
    return { members, attached: await this.isAttached(leagueId, userId) };
  }

  /** True when the caller's live member row in this league has been claimed (see ClaimQuestion). */
  private async isAttached(leagueId: string, userId: string): Promise<boolean> {
    const { data: own, error: ownErr } = await this.supabase
      .from('league_members')
      .select('id, claimed_at')
      .eq('league_id', leagueId)
      .eq('owner_id', userId)
      .is('merged_into_member_id', null)
      .limit(1);
    if (ownErr) throw new Error(`league_members read failed: ${ownErr.message}`);
    return ((own as Array<{ id: string; claimed_at: string | null }> | null)?.[0]?.claimed_at ?? null) != null;
  }

  /**
   * The signed-in user claims a member: token path from an invite link,
   * list-pick path otherwise. The function's own checks (unclaimed row, valid
   * token or league membership) come back as its exception text, which is
   * written for the person, so it is surfaced as a 400.
   */
  async claim(memberId: string, claimToken?: string | null): Promise<ClaimResult> {
    const { data, error } = await this.supabase.rpc('citrus_claim_league_member', { p_member_id: memberId, p_claim_token: claimToken ?? null });
    if (error) throw AppError.badRequest(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Claim returned no row');
    return row as ClaimResult;
  }

  /** Commissioner merges two rows that are the same person. Returns the surviving member id. */
  async merge(fromMemberId: string, intoMemberId: string, claimMethod: string | null = null): Promise<string> {
    const { data, error } = await this.supabase.rpc('citrus_merge_league_members', { p_from: fromMemberId, p_into: intoMemberId, p_claim_method: claimMethod });
    if (error) throw AppError.badRequest(error.message);
    return String(data);
  }

  /**
   * Commissioner attaches a member to a user directly. If that user already
   * holds a live row in the league (the foundation seed gives every current
   * team owner one), the imported row is merged into it so one person never
   * has two rows. Ordinary write policy: commissioner only.
   */
  async assign(leagueId: string, memberId: string, userId: string): Promise<{ memberId: string; merged: boolean }> {
    const { data: existing, error: eErr } = await this.supabase
      .from('league_members')
      .select('id')
      .eq('league_id', leagueId)
      .eq('owner_id', userId)
      .is('merged_into_member_id', null)
      .limit(1);
    if (eErr) throw new Error(`league_members read failed: ${eErr.message}`);
    const own = (existing as Array<{ id: string }> | null)?.[0]?.id ?? null;
    if (own === memberId) return { memberId, merged: false }; // already theirs; a repeat click is not an error
    if (own) {
      const survivor = await this.merge(memberId, own, 'commissioner_assign');
      return { memberId: survivor, merged: true };
    }
    const { data, error } = await this.supabase
      .from('league_members')
      .update({ owner_id: userId, claimed_at: new Date().toISOString(), claim_method: 'commissioner_assign', claim_token: null })
      .eq('league_id', leagueId)
      .eq('id', memberId)
      .is('owner_id', null)
      .select('id');
    if (error) throw new Error(`league_members update failed: ${error.message}`);
    if (!(data as unknown[] | null)?.length) throw AppError.conflict('That member is already claimed or does not exist in this league.');
    return { memberId, merged: false };
  }

  /** Commissioner reverses a wrong claim within the window. */
  async unclaim(leagueId: string, memberId: string): Promise<void> {
    const { error } = await this.supabase
      .from('league_members')
      .update({ owner_id: null, claimed_at: null, claim_method: null })
      .eq('league_id', leagueId)
      .eq('id', memberId);
    if (error) throw new Error(`league_members update failed: ${error.message}`);
  }
}
