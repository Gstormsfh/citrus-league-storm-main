/**
 * WHO TO TELL, AND WHAT TO SAY (2026-09-09).
 *
 * `PushService.notify` knows how to deliver to a set of user ids. It does not
 * know that a trade has two sides, that a league has ten other managers, or
 * that "Big Screen TV" is a team name and not a person. That resolution lives
 * here, so a route stays three lines and the wording of a notification is
 * stated in ONE file rather than scattered across eight call sites.
 *
 * TWO RULES EVERY METHOD FOLLOWS:
 *
 * 1. NEVER THROW, NEVER BLOCK THE CALLER. A trade must not fail because APNs
 *    was down, and a manager must not wait on a push round trip to see their
 *    own accepted trade. Every method catches everything and returns void;
 *    callers use `void dispatch.x(...)` deliberately, without awaiting.
 *
 * 2. THE ADMIN CLIENT, DELIBERATELY. Working out who to notify means reading
 *    other managers' team rows and profile switches — exactly what RLS stops
 *    a user client doing, and correctly so. The reads here are ids and
 *    display names only, they never leave the server, and nothing read here
 *    is returned to the caller. The alternative (RLS holes so a user client
 *    can enumerate the league) would be a far worse trade.
 *
 * DEDUPE KEYS cover the EVENT plus the RECIPIENT wherever a single event fans
 * out, because push_dedupe is keyed on one text column: `trade_league:<id>`
 * for eight managers would deliver to the first and silently drop seven.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger } from '@citrus/shared';
import { getPushService } from './PushService';

interface TeamRow {
  id: string;
  team_name: string | null;
  owner_id: string | null;
}

export class NotificationDispatch {
  constructor(private readonly admin: SupabaseClient) {}

  private push() {
    return getPushService(this.admin);
  }

  /** Teams by id, with owners. Unowned (AI) seats come back with owner_id null. */
  private async teams(teamIds: string[]): Promise<Map<string, TeamRow>> {
    const ids = Array.from(new Set(teamIds.filter(Boolean)));
    if (ids.length === 0) return new Map();
    const { data, error } = await this.admin
      .from('teams')
      .select('id, team_name, owner_id')
      .in('id', ids);
    if (error || !data) return new Map();
    return new Map((data as TeamRow[]).map((t) => [t.id, t]));
  }

  /** Every human manager in the league, optionally minus some. */
  private async leagueOwners(leagueId: string, exclude: (string | null | undefined)[] = []): Promise<string[]> {
    const { data, error } = await this.admin
      .from('teams')
      .select('owner_id')
      .eq('league_id', leagueId);
    if (error || !data) return [];
    const skip = new Set(exclude.filter(Boolean) as string[]);
    return Array.from(
      new Set(
        (data as Array<{ owner_id: string | null }>)
          .map((t) => t.owner_id)
          .filter((id): id is string => Boolean(id) && !skip.has(id)),
      ),
    );
  }

  private async leagueName(leagueId: string): Promise<string | null> {
    const { data } = await this.admin.from('leagues').select('name').eq('id', leagueId).maybeSingle();
    return (data as { name?: string } | null)?.name ?? null;
  }

  /**
   * Numeric NHL player ids to names, via `player_directory` — the table that
   * maps the integer ids waiver_claims and the roster use. (`players.id` is a
   * uuid and is NOT this id space; reaching for it here would silently return
   * nothing.)
   */
  private async playerNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
    const wanted = Array.from(new Set(ids.filter((n): n is number => Number.isFinite(n))));
    if (wanted.length === 0) return new Map();
    const { data, error } = await this.admin
      .from('player_directory')
      .select('player_id, full_name')
      .in('player_id', wanted);
    if (error || !data) return new Map();
    return new Map(
      (data as Array<{ player_id: number; full_name: string | null }>)
        .filter((r) => r.full_name)
        .map((r) => [r.player_id, r.full_name as string]),
    );
  }

  /** A team's display name, or a neutral fallback — never an empty string in a body. */
  private nameOf(team: TeamRow | undefined): string {
    const n = team?.team_name?.trim();
    return n && n.length > 0 ? n : 'Another team';
  }

  private async safely(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      structuredLogger.error(`[notify] ${what} threw: ${(err as Error).message}`);
    }
  }

  // ── Trades ──────────────────────────────────────────────────────

  /** A new offer landed. Only the receiving manager is interrupted. */
  async tradeOffered(input: {
    leagueId: string;
    tradeId: string;
    fromTeamId: string;
    toTeamId: string;
  }): Promise<void> {
    await this.safely('tradeOffered', async () => {
      const teams = await this.teams([input.fromTeamId, input.toTeamId]);
      const to = teams.get(input.toTeamId);
      if (!to?.owner_id) return; // AI seat — nobody to tell
      await this.push().notify({
        userIds: [to.owner_id],
        category: 'trade_offer',
        title: 'New trade offer',
        body: `${this.nameOf(teams.get(input.fromTeamId))} sent you an offer.`,
        // A trade you have not answered is the one non-draft push worth
        // breaking a Focus mode for: offers expire.
        timeSensitive: true,
        dedupeKey: `trade_offer:${input.tradeId}`,
        data: { leagueId: input.leagueId, tradeId: input.tradeId, route: `/trades?league=${input.leagueId}` },
      });
    });
  }

  /**
   * An offer reached its end state.
   *
   * Both sides hear the outcome under `trade_result`; the rest of the league
   * hears only a COMPLETED trade, under `trade_league`, because a rejected
   * offer is nobody else's business.
   */
  async tradeResolved(input: {
    leagueId: string;
    tradeId: string;
    fromTeamId: string;
    toTeamId: string;
    outcome: 'accepted' | 'rejected' | 'cancelled' | 'vetoed' | 'countered';
    /** Whoever performed the action; they already know, so they are not told. */
    actorUserId?: string | null;
  }): Promise<void> {
    await this.safely('tradeResolved', async () => {
      const teams = await this.teams([input.fromTeamId, input.toTeamId]);
      const from = teams.get(input.fromTeamId);
      const to = teams.get(input.toTeamId);
      const fromName = this.nameOf(from);
      const toName = this.nameOf(to);

      const verb: Record<typeof input.outcome, string> = {
        accepted: 'accepted',
        rejected: 'rejected',
        cancelled: 'cancelled',
        vetoed: 'vetoed by the league',
        countered: 'countered',
      };

      const parties = [from?.owner_id, to?.owner_id].filter(
        (id): id is string => Boolean(id) && id !== input.actorUserId,
      );
      if (parties.length > 0) {
        await this.push().notify({
          userIds: parties,
          category: 'trade_result',
          title: `Trade ${input.outcome === 'vetoed' ? 'vetoed' : verb[input.outcome]}`,
          body:
            input.outcome === 'vetoed'
              ? `The trade between ${fromName} and ${toName} was vetoed.`
              : `Your trade with ${fromName === toName ? 'another team' : toName} was ${verb[input.outcome]}.`,
          dedupeKey: `trade_result:${input.tradeId}:${input.outcome}`,
          data: { leagueId: input.leagueId, tradeId: input.tradeId, route: `/trades?league=${input.leagueId}` },
        });
      }

      if (input.outcome !== 'accepted') return;

      // League news, one dedupe key per recipient — see the header note.
      const others = await this.leagueOwners(input.leagueId, [from?.owner_id, to?.owner_id]);
      for (const userId of others) {
        await this.push().notify({
          userIds: [userId],
          category: 'trade_league',
          title: 'Trade in your league',
          body: `${fromName} and ${toName} completed a trade.`,
          dedupeKey: `trade_league:${input.tradeId}:${userId}`,
          data: { leagueId: input.leagueId, tradeId: input.tradeId, route: `/trades?league=${input.leagueId}` },
        });
      }
    });
  }

  // ── Roster ──────────────────────────────────────────────────────

  /**
   * A player moved. The owning manager hears it under `roster_own`; everyone
   * else under `roster_league`.
   *
   * `actorUserId` is skipped on the OWN notification only: a manager who just
   * tapped Drop does not need telling. The league still hears about it.
   */
  async rosterMove(input: {
    leagueId: string;
    teamId: string;
    /** Stable id for this move — the ledger row id where there is one. */
    eventId: string;
    /** Numeric NHL ids; names are resolved here so routes need not. */
    addedPlayerId?: number | null;
    droppedPlayerId?: number | null;
    actorUserId?: string | null;
    /**
     * Announce to the league but not to the owner. Set when the owner is
     * already being told by a more specific notification — a won waiver
     * sends `waiver_result`, and a second "your roster changed" for the same
     * player is the kind of double-buzz that gets an app muted.
     */
    skipOwn?: boolean;
  }): Promise<void> {
    await this.safely('rosterMove', async () => {
      const [teams, names] = await Promise.all([
        this.teams([input.teamId]),
        this.playerNames([input.addedPlayerId, input.droppedPlayerId]),
      ]);
      const team = teams.get(input.teamId);
      const teamName = this.nameOf(team);

      const added = input.addedPlayerId ? names.get(input.addedPlayerId) : undefined;
      const dropped = input.droppedPlayerId ? names.get(input.droppedPlayerId) : undefined;
      if (!added && !dropped) return;
      const what =
        added && dropped ? `added ${added} and dropped ${dropped}` : added ? `added ${added}` : `dropped ${dropped}`;

      if (!input.skipOwn && team?.owner_id && team.owner_id !== input.actorUserId) {
        await this.push().notify({
          userIds: [team.owner_id],
          category: 'roster_own',
          title: 'Your roster changed',
          body: `Your team ${what}.`,
          dedupeKey: `roster_own:${input.eventId}`,
          data: { leagueId: input.leagueId, route: `/roster?league=${input.leagueId}` },
        });
      }

      const others = await this.leagueOwners(input.leagueId, [team?.owner_id]);
      for (const userId of others) {
        await this.push().notify({
          userIds: [userId],
          category: 'roster_league',
          title: 'Roster move',
          body: `${teamName} ${what}.`,
          dedupeKey: `roster_league:${input.eventId}:${userId}`,
          data: { leagueId: input.leagueId, route: `/league/${input.leagueId}` },
        });
      }
    });
  }

  /** A waiver claim settled. Only the claiming manager is told, win or lose. */
  async waiverResult(input: {
    leagueId: string;
    claimId: string;
    teamId: string;
    playerId?: number | null;
    won: boolean;
    failureReason?: string | null;
  }): Promise<void> {
    await this.safely('waiverResult', async () => {
      const [teams, names] = await Promise.all([
        this.teams([input.teamId]),
        this.playerNames([input.playerId]),
      ]);
      const owner = teams.get(input.teamId)?.owner_id;
      if (!owner) return;
      const player = (input.playerId ? names.get(input.playerId) : undefined) || 'Your claim';
      await this.push().notify({
        userIds: [owner],
        category: 'waiver_result',
        title: input.won ? 'Waiver claim won' : 'Waiver claim lost',
        body: input.won
          ? `${player} is on your roster.`
          : `${player} went to another team.${input.failureReason ? ` ${input.failureReason}` : ''}`,
        dedupeKey: `waiver_result:${input.claimId}`,
        data: { leagueId: input.leagueId, route: `/waivers?league=${input.leagueId}` },
      });
    });
  }

  /**
   * Announce a completed waiver RUN from the claim rows themselves.
   *
   * Deliberately NOT driven by the processor RPC's return value: the rolling
   * and FAAB processors return different shapes, and one of them reports on
   * every league it touched rather than just this one. The claims table is
   * the source of truth about what actually happened, and every notification
   * here is keyed on the claim id, so re-running the processor — which the
   * commissioner button allows — cannot double-notify anyone.
   */
  async waiverRunCompleted(input: { leagueId: string; since: Date }): Promise<void> {
    await this.safely('waiverRunCompleted', async () => {
      const { data, error } = await this.admin
        .from('waiver_claims')
        .select('id, team_id, player_id, drop_player_id, status, failure_reason')
        .eq('league_id', input.leagueId)
        .in('status', ['successful', 'failed'])
        .gte('processed_at', input.since.toISOString());
      if (error || !data) return;

      const claims = data as Array<{
        id: string;
        team_id: string;
        player_id: number;
        drop_player_id: number | null;
        status: string;
        failure_reason: string | null;
      }>;

      for (const claim of claims) {
        const won = claim.status === 'successful';
        await this.waiverResult({
          leagueId: input.leagueId,
          claimId: claim.id,
          teamId: claim.team_id,
          playerId: claim.player_id,
          won,
          failureReason: claim.failure_reason,
        });
        // A won claim is also league news. The owner already heard it above,
        // so only the rest of the league is told.
        if (won) {
          await this.rosterMove({
            leagueId: input.leagueId,
            teamId: claim.team_id,
            eventId: `waiver:${claim.id}`,
            addedPlayerId: claim.player_id,
            droppedPlayerId: claim.drop_player_id,
            skipOwn: true,
          });
        }
      }
    });
  }

  // ── League ──────────────────────────────────────────────────────

  /**
   * Managers who have blocked the sender, or whom the sender has blocked.
   *
   * `send_league_chat_message` already refuses to create a notification row
   * for either direction of a block, so a push without this filter would
   * announce a message the recipient cannot open — the single most alarming
   * way to fail at a safety feature. Mirrored here deliberately rather than
   * inferred from the row count the RPC returns.
   */
  private async blockedWith(userId: string | null | undefined): Promise<Set<string>> {
    if (!userId) return new Set();
    const { data, error } = await this.admin
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
    if (error || !data) return new Set();
    const out = new Set<string>();
    for (const row of data as Array<{ blocker_id: string; blocked_id: string }>) {
      out.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id);
    }
    return out;
  }

  /**
   * Who this message names.
   *
   * `@handle` first, because that is the deliberate gesture. A bare name also
   * counts when it matches a manager's username or team name on a word
   * boundary, since nobody in a twelve-person league types the @.
   *
   * Matching is against the league's OWN members only — never every profile —
   * so a common username cannot pull a stranger into a league's chat.
   */
  private async mentionedIn(
    leagueId: string,
    message: string,
    audience: string[],
  ): Promise<Set<string>> {
    const hit = new Set<string>();
    if (audience.length === 0) return hit;

    const [{ data: profiles }, { data: teams }] = await Promise.all([
      this.admin.from('profiles').select('id, username').in('id', audience),
      this.admin.from('teams').select('owner_id, team_name').eq('league_id', leagueId),
    ]);

    const names: Array<{ userId: string; name: string }> = [];
    for (const p of (profiles ?? []) as Array<{ id: string; username: string | null }>) {
      if (p.username?.trim()) names.push({ userId: p.id, name: p.username.trim() });
    }
    for (const t of (teams ?? []) as Array<{ owner_id: string | null; team_name: string | null }>) {
      if (t.owner_id && audience.includes(t.owner_id) && t.team_name?.trim()) {
        names.push({ userId: t.owner_id, name: t.team_name.trim() });
      }
    }

    const haystack = message.toLowerCase();
    const eligible = new Set(audience);
    for (const { userId, name } of names) {
      // Intersect with the audience HERE rather than trusting the `.in()`
      // filter on the profiles query. The audience has already had blocked
      // managers removed, and "a blocked manager is unreachable" must be a
      // property of this function, not of a query clause a later edit could
      // widen. Cheap insurance on the one path where being wrong means
      // pushing a message the recipient is not allowed to see.
      if (!eligible.has(userId)) continue;
      const needle = name.toLowerCase();
      // Two characters is not a mention, it is a coincidence.
      if (needle.length < 3) continue;
      if (haystack.includes(`@${needle}`)) {
        hit.add(userId);
        continue;
      }
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`).test(haystack)) hit.add(userId);
    }
    return hit;
  }

  /**
   * A chat message.
   *
   * Someone named in the message gets `chat_mention`; everyone else gets
   * `chat_all`. A mentioned manager is NOT also sent the chat_all copy — two
   * pushes for one message is the fastest way to get an app muted.
   *
   * Blocks are honoured in both directions, matching the RPC that wrote the
   * message.
   */
  async chatMessage(input: {
    leagueId: string;
    messageId: string;
    senderUserId: string | null;
    senderName?: string | null;
    message: string;
    /** Optional override; resolved from the text when absent. */
    mentionedUserIds?: string[];
  }): Promise<void> {
    await this.safely('chatMessage', async () => {
      const blocked = await this.blockedWith(input.senderUserId);
      const audience = (await this.leagueOwners(input.leagueId, [input.senderUserId])).filter(
        (id) => !blocked.has(id),
      );
      if (audience.length === 0) return;

      const mentioned = input.mentionedUserIds
        ? new Set(input.mentionedUserIds.filter((id) => audience.includes(id)))
        : await this.mentionedIn(input.leagueId, input.message, audience);

      const sender = input.senderName?.trim() || 'Someone';
      const text = input.message.trim().slice(0, 140);

      for (const userId of mentioned) {
        await this.push().notify({
          userIds: [userId],
          category: 'chat_mention',
          title: `${sender} mentioned you`,
          body: text,
          dedupeKey: `chat_mention:${input.messageId}:${userId}`,
          data: { leagueId: input.leagueId, route: `/league/${input.leagueId}` },
        });
      }

      for (const userId of audience) {
        if (mentioned.has(userId)) continue;
        await this.push().notify({
          userIds: [userId],
          category: 'chat_all',
          title: `${sender} in league chat`,
          body: text,
          dedupeKey: `chat_all:${input.messageId}:${userId}`,
          data: { leagueId: input.leagueId, route: `/league/${input.leagueId}` },
        });
      }
    });
  }

  /** The commissioner changed a rule. Everyone but the commissioner hears it. */
  async leagueSettingsChanged(input: {
    leagueId: string;
    eventId: string;
    summary: string;
    actorUserId?: string | null;
  }): Promise<void> {
    await this.safely('leagueSettingsChanged', async () => {
      const audience = await this.leagueOwners(input.leagueId, [input.actorUserId]);
      const league = await this.leagueName(input.leagueId);
      for (const userId of audience) {
        await this.push().notify({
          userIds: [userId],
          category: 'league_admin',
          title: league ? `${league} settings changed` : 'League settings changed',
          body: input.summary.trim().slice(0, 140),
          dedupeKey: `league_admin:${input.eventId}:${userId}`,
          data: { leagueId: input.leagueId, route: `/league/${input.leagueId}` },
        });
      }
    });
  }

  // ── Draft ───────────────────────────────────────────────────────

  /** A pick was made. Default-off category; see notificationCategories. */
  async draftPickMade(input: {
    leagueId: string;
    pickNumber: number;
    teamId: string;
    playerName?: string | null;
  }): Promise<void> {
    await this.safely('draftPickMade', async () => {
      const teams = await this.teams([input.teamId]);
      const team = teams.get(input.teamId);
      const audience = await this.leagueOwners(input.leagueId, [team?.owner_id]);
      const player = input.playerName?.trim();
      if (!player) return;
      for (const userId of audience) {
        await this.push().notify({
          userIds: [userId],
          category: 'draft_pick',
          title: `Pick ${input.pickNumber}`,
          body: `${this.nameOf(team)} took ${player}.`,
          dedupeKey: `draft_pick:${input.leagueId}:${input.pickNumber}:${userId}`,
          data: { leagueId: input.leagueId, route: `/draft-room/${input.leagueId}` },
        });
      }
    });
  }

  /** The draft is about to start. Everyone in the league. */
  async draftStarting(input: { leagueId: string; eventId: string; minutesAway?: number | null }): Promise<void> {
    await this.safely('draftStarting', async () => {
      const audience = await this.leagueOwners(input.leagueId);
      const league = await this.leagueName(input.leagueId);
      const when =
        typeof input.minutesAway === 'number' && input.minutesAway > 0
          ? `starts in ${input.minutesAway} minutes`
          : 'is starting';
      for (const userId of audience) {
        await this.push().notify({
          userIds: [userId],
          category: 'draft_start',
          title: 'Draft starting',
          body: league ? `${league} ${when}.` : `Your draft ${when}.`,
          timeSensitive: true,
          dedupeKey: `draft_start:${input.eventId}:${userId}`,
          data: { leagueId: input.leagueId, route: `/draft-room/${input.leagueId}` },
        });
      }
    });
  }
}

let shared: NotificationDispatch | null = null;

/** Process-wide instance; the push transport underneath is already pooled. */
export function getNotificationDispatch(admin: SupabaseClient): NotificationDispatch {
  if (!shared) shared = new NotificationDispatch(admin);
  return shared;
}

/** Tests only. */
export function resetNotificationDispatch(): void {
  shared = null;
}
