/**
 * The part of an import a keeper or dynasty league is actually attached to:
 * not last year's standings but next year's draft. Two carry-overs, both
 * commissioner actions, both explained before they are applied:
 *
 *   keepers   the keeper list the source showed (league_season_keepers,
 *             newest season) becomes Citrus keeper_designations for the
 *             coming draft, as 'designated' rows the existing keeper panel
 *             then locks. A keeper needs two things to land: the manager
 *             must have claimed their Citrus team, and the player must be
 *             resolved to an NHL id. The plan lists what is missing.
 *
 *   picks     league_pick_ownership rows for the coming draft rewrite
 *             draft_order.team_order: the owner's team takes the original
 *             team's slot in that round. The engine reads team_order as it
 *             is, so a team drafting twice in round 2 and not at all in
 *             round 3 is just the order. Only before the draft ignites, and
 *             only once the draft order exists; idempotent, because a slot
 *             whose original team is already gone is left alone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../lib/errors';

interface MemberTeam { memberId: string; displayName: string; ownerId: string | null; teamId: string | null; teamName: string | null }

export interface KeeperPlanRow {
  memberId: string; memberName: string; teamId: string | null; teamName: string | null;
  playerName: string | null; nhlPlayerId: number | null; externalPlayerId: string; round: number | null; yearsKept: number | null;
  /** Why the row cannot land yet, or null when it can. */
  blocker: 'unclaimed' | 'unmatched' | null;
}

export interface KeeperPlan { season: number | null; seasonYear: number; rows: KeeperPlanRow[]; ready: number; blocked: number }

export interface PickOwnershipRow {
  draftSeason: number; round: number;
  originalMemberId: string; originalName: string; originalTeamId: string | null;
  ownerMemberId: string; ownerName: string; ownerTeamId: string | null;
  appliedAt: string | null; source: string;
  blocker: 'unclaimed' | null;
}

export interface PickApplyResult { applied: number; alreadyApplied: number; skipped: Array<{ round: number; reason: string }> }

export class DynastyCarryoverService {
  constructor(private readonly supabase: SupabaseClient) {}

  /** Live member rows joined to the Citrus team the same person owns, when they have claimed one. */
  private async memberTeams(leagueId: string): Promise<Map<string, MemberTeam>> {
    const [{ data: members, error: mErr }, { data: teams, error: tErr }] = await Promise.all([
      this.supabase.from('league_members').select('id, display_name, owner_id').eq('league_id', leagueId).is('merged_into_member_id', null),
      this.supabase.from('teams').select('id, team_name, owner_id').eq('league_id', leagueId),
    ]);
    if (mErr) throw new Error(`league_members read failed: ${mErr.message}`);
    if (tErr) throw new Error(`teams read failed: ${tErr.message}`);
    const teamByOwner = new Map<string, { id: string; team_name: string }>();
    for (const t of (teams ?? []) as Array<{ id: string; team_name: string; owner_id: string | null }>) if (t.owner_id) teamByOwner.set(t.owner_id, t);
    const out = new Map<string, MemberTeam>();
    for (const m of (members ?? []) as Array<{ id: string; display_name: string; owner_id: string | null }>) {
      const team = m.owner_id ? teamByOwner.get(m.owner_id) : undefined;
      out.set(m.id, { memberId: m.id, displayName: m.display_name, ownerId: m.owner_id, teamId: team?.id ?? null, teamName: team?.team_name ?? null });
    }
    return out;
  }

  // ---- keepers ----------------------------------------------------------------

  async keeperPlan(leagueId: string, seasonYear: number): Promise<KeeperPlan> {
    const { data: newest, error: nErr } = await this.supabase
      .from('league_season_keepers').select('season').eq('league_id', leagueId).order('season', { ascending: false }).limit(1);
    if (nErr) throw new Error(`league_season_keepers read failed: ${nErr.message}`);
    const season = ((newest as Array<{ season: number }> | null)?.[0]?.season) ?? null;
    if (season == null) return { season: null, seasonYear, rows: [], ready: 0, blocked: 0 };
    const { data, error } = await this.supabase
      .from('league_season_keepers')
      .select('member_id, external_player_id, external_player_name, nhl_player_id, round, years_kept')
      .eq('league_id', leagueId).eq('season', season);
    if (error) throw new Error(`league_season_keepers read failed: ${error.message}`);
    const members = await this.memberTeams(leagueId);
    const rows: KeeperPlanRow[] = ((data ?? []) as Array<{ member_id: string; external_player_id: string; external_player_name: string | null; nhl_player_id: number | null; round: number | null; years_kept: number | null }>)
      .map((k): KeeperPlanRow => {
        const m = members.get(k.member_id);
        return {
          memberId: k.member_id, memberName: m?.displayName ?? 'Unknown manager', teamId: m?.teamId ?? null, teamName: m?.teamName ?? null,
          playerName: k.external_player_name, nhlPlayerId: k.nhl_player_id, externalPlayerId: k.external_player_id, round: k.round, yearsKept: k.years_kept,
          blocker: !m?.teamId ? 'unclaimed' : k.nhl_player_id == null ? 'unmatched' : null,
        };
      })
      .sort((a, b) => a.memberName.localeCompare(b.memberName) || (a.playerName ?? '').localeCompare(b.playerName ?? ''));
    return { season, seasonYear, rows, ready: rows.filter((r) => !r.blocker).length, blocked: rows.filter((r) => r.blocker).length };
  }

  /** Writes every ready row through the SECURITY DEFINER prefill; blocked rows wait. */
  async applyKeepers(leagueId: string, seasonYear: number): Promise<{ written: number; skippedLocked: number; blocked: number }> {
    const plan = await this.keeperPlan(leagueId, seasonYear);
    const ready = plan.rows.filter((r) => !r.blocker);
    if (!ready.length) return { written: 0, skippedLocked: 0, blocked: plan.blocked };
    const { data, error } = await this.supabase.rpc('citrus_apply_imported_keepers', {
      p_league_id: leagueId, p_season_year: seasonYear,
      p_rows: ready.map((r) => ({ team_id: r.teamId, player_id: String(r.nhlPlayerId), original_draft_round: r.round, years_kept: r.yearsKept ?? 1 })),
    });
    if (error) throw AppError.badRequest(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { written?: number; skipped_locked?: number } | null;
    return { written: Number(row?.written ?? 0), skippedLocked: Number(row?.skipped_locked ?? 0), blocked: plan.blocked };
  }

  // ---- traded picks -------------------------------------------------------------

  async pickOwnership(leagueId: string): Promise<PickOwnershipRow[]> {
    const { data, error } = await this.supabase
      .from('league_pick_ownership')
      .select('draft_season, round, original_member_id, owner_member_id, applied_at, source')
      .eq('league_id', leagueId)
      .order('draft_season', { ascending: true }).order('round', { ascending: true });
    if (error) throw new Error(`league_pick_ownership read failed: ${error.message}`);
    const members = await this.memberTeams(leagueId);
    return ((data ?? []) as Array<{ draft_season: number; round: number; original_member_id: string; owner_member_id: string; applied_at: string | null; source: string }>).map((r) => {
      const o = members.get(r.original_member_id);
      const w = members.get(r.owner_member_id);
      return {
        draftSeason: r.draft_season, round: r.round,
        originalMemberId: r.original_member_id, originalName: o?.displayName ?? 'Unknown manager', originalTeamId: o?.teamId ?? null,
        ownerMemberId: r.owner_member_id, ownerName: w?.displayName ?? 'Unknown manager', ownerTeamId: w?.teamId ?? null,
        appliedAt: r.applied_at, source: r.source,
        blocker: o?.teamId && w?.teamId ? null : 'unclaimed',
      };
    });
  }

  /**
   * Rewrites draft_order for the coming draft. Refuses once the draft has
   * started and before the order exists; the message says which.
   */
  async applyPickOwnership(leagueId: string, draftSeason: number): Promise<PickApplyResult> {
    const { data: league, error: lErr } = await this.supabase.from('leagues').select('id, draft_status').eq('id', leagueId).maybeSingle();
    if (lErr) throw new Error(`leagues read failed: ${lErr.message}`);
    const status = (league as { draft_status?: string } | null)?.draft_status ?? 'not_started';
    if (status !== 'not_started' && status !== 'queued') throw AppError.conflict(`The draft is ${status}. Traded picks can only be applied before it starts.`);

    const { data: orderRows, error: oErr } = await this.supabase
      .from('draft_order').select('id, round_number, team_order').eq('league_id', leagueId).order('round_number', { ascending: true });
    if (oErr) throw new Error(`draft_order read failed: ${oErr.message}`);
    const rounds = (orderRows ?? []) as Array<{ id: string; round_number: number; team_order: string[] }>;
    if (!rounds.length) throw AppError.conflict('Set the draft order first (Draft Room, Set order), then apply the traded picks to it.');

    const rows = (await this.pickOwnership(leagueId)).filter((r) => r.draftSeason === draftSeason);
    const result: PickApplyResult = { applied: 0, alreadyApplied: 0, skipped: [] };
    const changed = new Map<string, { id: string; team_order: string[] }>();
    const landed: PickOwnershipRow[] = [];
    for (const r of rows) {
      if (r.blocker) { result.skipped.push({ round: r.round, reason: `${r.originalName} or ${r.ownerName} has not claimed a team yet.` }); continue; }
      const round = rounds.find((x) => x.round_number === r.round);
      if (!round) { result.skipped.push({ round: r.round, reason: `The draft has no round ${r.round}.` }); continue; }
      const order = changed.get(round.id)?.team_order ?? [...round.team_order];
      const at = order.indexOf(r.originalTeamId!);
      if (at === -1) {
        // The original team already has no slot here: applied before, or the order was built without them.
        result.alreadyApplied += 1;
        landed.push(r);
        continue;
      }
      order[at] = r.ownerTeamId!;
      changed.set(round.id, { id: round.id, team_order: order });
      result.applied += 1;
      landed.push(r);
    }
    for (const row of changed.values()) {
      const { error } = await this.supabase.from('draft_order').update({ team_order: row.team_order }).eq('id', row.id).eq('league_id', leagueId);
      if (error) throw new Error(`draft_order update failed: ${error.message}`);
    }
    const stamp = new Date().toISOString();
    for (const r of landed) {
      if (r.appliedAt) continue;
      const { error } = await this.supabase.from('league_pick_ownership').update({ applied_at: stamp })
        .eq('league_id', leagueId).eq('draft_season', draftSeason).eq('round', r.round).eq('original_member_id', r.originalMemberId);
      if (error) throw new Error(`league_pick_ownership update failed: ${error.message}`);
    }
    return result;
  }
}
