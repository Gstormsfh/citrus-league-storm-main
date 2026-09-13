/**
 * One league_members row per human, across every imported season.
 *
 * The key is the source's account id (Yahoo guid, ESPN SWID), never the team
 * id (reused when a manager leaves) and never the name (changes every year).
 * Co-managers map to the same member. The importer's own id is attached to
 * their Citrus account immediately, so they see their trophies before anyone
 * else has joined; everyone else is created unclaimed with a claim token.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import type { ImportedSeason, ImportedManager, ImportPlatform } from '../../import/types';

export interface MemberResolution {
  /** externalManagerId -> league_members.id (survivor after merges). */
  byExternalId: Map<string, string>;
  /** externalTeamId (this season) -> league_members.id of the primary manager. */
  byTeamId: Map<string, string>;
  created: number;
  matchedExisting: number;
}

interface MemberRow { id: string; owner_id: string | null; display_name: string; merged_into_member_id: string | null; first_season: number | null; last_season: number | null; claimed_at: string | null }
interface IdentityRow { member_id: string; external_manager_id: string }

const MEMBER_COLUMNS = 'id, owner_id, display_name, merged_into_member_id, first_season, last_season, claimed_at';

export function newClaimToken(): string {
  return randomBytes(24).toString('base64url');
}

export class ExternalIdentityService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Ensure a member row exists for every manager in the season and return the
   * lookups the writer needs. `importerExternalId` is the id the source
   * reported for the authenticated importer (Yahoo: from OAuth; ESPN: the
   * SWID they supplied), so their row is claimed on the spot.
   */
  async resolveSeason(
    leagueId: string,
    season: ImportedSeason,
    opts: { importerUserId: string; importerExternalId?: string | null },
  ): Promise<MemberResolution> {
    const platform: ImportPlatform = season.platform;
    const managers = new Map<string, ImportedManager>();
    const coManagers = new Set<string>();
    for (const t of season.teams) {
      t.managers.forEach((m, i) => {
        if (!m.externalManagerId) return;
        managers.set(m.externalManagerId, m);
        if (i > 0) coManagers.add(m.externalManagerId);
      });
    }
    // A primary manager anywhere is a primary manager.
    for (const t of season.teams) if (t.managers[0]?.externalManagerId) coManagers.delete(t.managers[0].externalManagerId);
    const externalIds = Array.from(managers.keys());

    // Existing identities for this league+platform.
    const { data: idRows, error: idErr } = await this.supabase
      .from('league_member_identities')
      .select('member_id, external_manager_id')
      .eq('league_id', leagueId)
      .eq('platform', platform)
      .in('external_manager_id', externalIds.length ? externalIds : ['__none__']);
    if (idErr) throw new Error(`league_member_identities read failed: ${idErr.message}`);

    const byExternalId = new Map<string, string>();
    for (const r of (idRows ?? []) as IdentityRow[]) byExternalId.set(r.external_manager_id, r.member_id);

    // Follow merges to the surviving row.
    if (byExternalId.size) {
      const { data: memberRows, error: mErr } = await this.supabase
        .from('league_members')
        .select(MEMBER_COLUMNS)
        .in('id', Array.from(new Set(byExternalId.values())));
      if (mErr) throw new Error(`league_members read failed: ${mErr.message}`);
      const survivor = new Map<string, string>();
      for (const m of (memberRows ?? []) as MemberRow[]) survivor.set(m.id, m.merged_into_member_id ?? m.id);
      for (const [ext, mid] of byExternalId) byExternalId.set(ext, survivor.get(mid) ?? mid);
    }

    let created = 0;
    let matchedExisting = byExternalId.size;

    // The importer: attach to their existing owner-linked row if they have one
    // (the foundation seed creates one per current team owner), else create claimed.
    const importerExt = opts.importerExternalId ?? null;
    if (importerExt && managers.has(importerExt) && !byExternalId.has(importerExt)) {
      const { data: own, error: ownErr } = await this.supabase
        .from('league_members')
        .select(MEMBER_COLUMNS)
        .eq('league_id', leagueId)
        .eq('owner_id', opts.importerUserId)
        .is('merged_into_member_id', null)
        .limit(1);
      if (ownErr) throw new Error(`league_members read failed: ${ownErr.message}`);
      const existing = (own ?? [])[0] as MemberRow | undefined;
      if (existing) {
        byExternalId.set(importerExt, existing.id);
        matchedExisting += 1;
        // The seeded row has no claimed_at. Stamp it: claimed_at is what the
        // "which one is you?" screens read to know this person is done.
        if (existing.claimed_at == null) {
          const { error: stampErr } = await this.supabase
            .from('league_members')
            .update({ claimed_at: new Date().toISOString(), claim_method: 'oauth_match', claim_token: null })
            .eq('id', existing.id);
          if (stampErr) throw new Error(`league_members update failed: ${stampErr.message}`);
        }
      } else {
        const id = await this.insertMember(leagueId, managers.get(importerExt)!.displayName, season.season, {
          ownerId: opts.importerUserId, claimMethod: 'oauth_match',
        });
        byExternalId.set(importerExt, id);
        created += 1;
      }
      await this.upsertIdentity(leagueId, platform, importerExt, byExternalId.get(importerExt)!, managers.get(importerExt)!, season.season, coManagers.has(importerExt));
    }

    // Everyone else: unclaimed with a claim token.
    for (const [ext, mgr] of managers) {
      if (byExternalId.has(ext)) {
        await this.touchIdentitySeason(leagueId, platform, ext, season.season, mgr);
        continue;
      }
      const id = await this.insertMember(leagueId, mgr.displayName, season.season, { ownerId: null, claimMethod: null });
      byExternalId.set(ext, id);
      created += 1;
      await this.upsertIdentity(leagueId, platform, ext, id, mgr, season.season, coManagers.has(ext));
    }

    // Widen first/last season on every touched member.
    await this.widenSeasons(Array.from(new Set(byExternalId.values())), season.season);

    const byTeamId = new Map<string, string>();
    for (const t of season.teams) {
      const primary = t.managers[0]?.externalManagerId;
      if (primary && byExternalId.has(primary)) byTeamId.set(t.externalTeamId, byExternalId.get(primary)!);
    }
    return { byExternalId, byTeamId, created, matchedExisting };
  }

  private async insertMember(leagueId: string, displayName: string, season: number, o: { ownerId: string | null; claimMethod: string | null }): Promise<string> {
    const { data, error } = await this.supabase
      .from('league_members')
      .insert({
        league_id: leagueId,
        display_name: displayName || 'Unknown manager',
        owner_id: o.ownerId,
        claim_method: o.claimMethod,
        claimed_at: o.ownerId ? new Date().toISOString() : null,
        claim_token: o.ownerId ? null : newClaimToken(),
        first_season: season,
        last_season: season,
      })
      .select('id')
      .single();
    if (error) throw new Error(`league_members insert failed: ${error.message}`);
    return (data as { id: string }).id;
  }

  private async upsertIdentity(leagueId: string, platform: ImportPlatform, ext: string, memberId: string, mgr: ImportedManager, season: number, isCoManager = false): Promise<void> {
    const { error } = await this.supabase
      .from('league_member_identities')
      .upsert({
        league_id: leagueId, platform, external_manager_id: ext, member_id: memberId,
        display_name: mgr.displayName, email_hint: mgr.emailHint ?? null,
        first_seen_season: season, last_seen_season: season, is_co_manager: isCoManager,
      }, { onConflict: 'league_id,platform,external_manager_id' });
    if (error) throw new Error(`league_member_identities upsert failed: ${error.message}`);
  }

  private async touchIdentitySeason(leagueId: string, platform: ImportPlatform, ext: string, season: number, mgr: ImportedManager): Promise<void> {
    // Keep the most recent display name; widen the seen range.
    const { data, error } = await this.supabase
      .from('league_member_identities')
      .select('first_seen_season, last_seen_season')
      .eq('league_id', leagueId).eq('platform', platform).eq('external_manager_id', ext)
      .maybeSingle();
    if (error) throw new Error(`league_member_identities read failed: ${error.message}`);
    const row = data as { first_seen_season: number | null; last_seen_season: number | null } | null;
    const first = Math.min(row?.first_seen_season ?? season, season);
    const last = Math.max(row?.last_seen_season ?? season, season);
    const update: Record<string, unknown> = { first_seen_season: first, last_seen_season: last };
    if (season >= last) update.display_name = mgr.displayName;
    const { error: uErr } = await this.supabase
      .from('league_member_identities')
      .update(update)
      .eq('league_id', leagueId).eq('platform', platform).eq('external_manager_id', ext);
    if (uErr) throw new Error(`league_member_identities update failed: ${uErr.message}`);
  }

  private async widenSeasons(memberIds: string[], season: number): Promise<void> {
    if (!memberIds.length) return;
    const { data, error } = await this.supabase
      .from('league_members')
      .select('id, first_season, last_season')
      .in('id', memberIds);
    if (error) throw new Error(`league_members read failed: ${error.message}`);
    for (const m of (data ?? []) as Array<{ id: string; first_season: number | null; last_season: number | null }>) {
      const first = m.first_season == null ? season : Math.min(m.first_season, season);
      const last = m.last_season == null ? season : Math.max(m.last_season, season);
      if (first === m.first_season && last === m.last_season) continue;
      const { error: uErr } = await this.supabase.from('league_members').update({ first_season: first, last_season: last }).eq('id', m.id);
      if (uErr) throw new Error(`league_members update failed: ${uErr.message}`);
    }
  }
}
