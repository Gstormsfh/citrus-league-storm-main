/**
 * NotificationDispatch — who gets told, and who deliberately does not.
 *
 * PushService decides whether a user WANTS a category. This layer decides who
 * is even a candidate, and that is where the judgement calls live. What is
 * pinned here:
 *
 *   1. THE ACTOR IS NEVER TOLD WHAT THEY JUST DID. A manager who taps Accept
 *      does not need a push saying their trade was accepted.
 *   2. A REJECTED TRADE IS NOT LEAGUE NEWS. Only an accepted one fans out.
 *   3. FAN-OUT KEYS INCLUDE THE RECIPIENT. push_dedupe is one text column, so
 *      a single key for eight managers would deliver to one and silently drop
 *      seven. This is the bug most likely to be introduced by a later edit,
 *      so it is asserted directly.
 *   4. BLOCKS ARE HONOURED IN BOTH DIRECTIONS, matching
 *      send_league_chat_message. Pushing a message the recipient cannot open
 *      is the worst possible way to fail at a safety feature.
 *   5. A MENTION REPLACES THE BULK COPY. Never two pushes for one message.
 *   6. UNOWNED (AI) SEATS RESOLVE QUIETLY. 38 teams in prod have owner_id null.
 *   7. NOTHING THROWS. A trade must not fail because a push did.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationDispatch } from '../services/NotificationDispatch';

const notify = vi.fn().mockResolvedValue({ sent: 1, failed: 0, skipped: false });
vi.mock('../services/PushService', () => ({
  getPushService: () => ({ notify }),
}));
vi.mock('@citrus/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@citrus/shared')>();
  return { ...actual, structuredLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});

/**
 * A Supabase double driven by a per-table result map. Each entry is a function
 * of the accumulated filters, so a test can vary a result by league without
 * building a second client.
 */
function makeSupabase(results: Record<string, unknown[]>) {
  const from = vi.fn((table: string) => {
    const rows = results[table] ?? [];
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gte', 'or', 'order', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null });
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej);
    return chain;
  });
  return { from } as never;
}

const LEAGUE = 'league-1';
const teamsInLeague = [
  { id: 'team-a', team_name: 'G Daddy', owner_id: 'user-a', league_id: LEAGUE },
  { id: 'team-b', team_name: 'Big Screen TV', owner_id: 'user-b', league_id: LEAGUE },
  { id: 'team-c', team_name: 'Third Team', owner_id: 'user-c', league_id: LEAGUE },
  { id: 'team-ai', team_name: 'AI Team 2', owner_id: null, league_id: LEAGUE },
];

function callsFor(category: string) {
  return notify.mock.calls.map((c) => c[0]).filter((a) => a.category === category);
}

beforeEach(() => notify.mockClear());

describe('trades', () => {
  it('tells only the receiving manager about a new offer, time-sensitive', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague }));
    await d.tradeOffered({ leagueId: LEAGUE, tradeId: 't1', fromTeamId: 'team-a', toTeamId: 'team-b' });

    const sent = callsFor('trade_offer');
    expect(sent).toHaveLength(1);
    expect(sent[0].userIds).toEqual(['user-b']);
    expect(sent[0].body).toContain('G Daddy');
    expect(sent[0].timeSensitive).toBe(true);
    expect(sent[0].dedupeKey).toBe('trade_offer:t1');
  });

  it('sends nothing when the offer goes to an AI seat', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague }));
    await d.tradeOffered({ leagueId: LEAGUE, tradeId: 't1', fromTeamId: 'team-a', toTeamId: 'team-ai' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('an accepted trade tells the other side and then the rest of the league', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague }));
    await d.tradeResolved({
      leagueId: LEAGUE,
      tradeId: 't1',
      fromTeamId: 'team-a',
      toTeamId: 'team-b',
      outcome: 'accepted',
      actorUserId: 'user-b',
    });

    // The actor accepted it; they know.
    const results = callsFor('trade_result');
    expect(results).toHaveLength(1);
    expect(results[0].userIds).toEqual(['user-a']);

    // user-c is the only manager not party to it. The AI seat has no owner.
    const league = callsFor('trade_league');
    expect(league).toHaveLength(1);
    expect(league[0].userIds).toEqual(['user-c']);
  });

  it('a rejected trade is not league news', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague }));
    await d.tradeResolved({
      leagueId: LEAGUE,
      tradeId: 't1',
      fromTeamId: 'team-a',
      toTeamId: 'team-b',
      outcome: 'rejected',
      actorUserId: 'user-b',
    });
    expect(callsFor('trade_league')).toHaveLength(0);
    expect(callsFor('trade_result')).toHaveLength(1);
  });

  it('a veto tells both sides — the commissioner acted, not them', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague }));
    await d.tradeResolved({
      leagueId: LEAGUE,
      tradeId: 't1',
      fromTeamId: 'team-a',
      toTeamId: 'team-b',
      outcome: 'vetoed',
      actorUserId: 'commish',
    });
    const results = callsFor('trade_result');
    expect(results).toHaveLength(1);
    expect(results[0].userIds.sort()).toEqual(['user-a', 'user-b']);
  });

  it('gives each league recipient its own dedupe key', async () => {
    const many = [
      ...teamsInLeague,
      { id: 'team-d', team_name: 'Fourth', owner_id: 'user-d', league_id: LEAGUE },
    ];
    const d = new NotificationDispatch(makeSupabase({ teams: many }));
    await d.tradeResolved({
      leagueId: LEAGUE,
      tradeId: 't1',
      fromTeamId: 'team-a',
      toTeamId: 'team-b',
      outcome: 'accepted',
      actorUserId: 'user-b',
    });
    const keys = callsFor('trade_league').map((c) => c.dedupeKey);
    expect(keys).toEqual(['trade_league:t1:user-c', 'trade_league:t1:user-d']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('roster', () => {
  const directory = [
    { player_id: 8478402, full_name: 'Connor McDavid' },
    { player_id: 8480069, full_name: 'Macklin Celebrini' },
  ];

  it('names the players rather than their ids', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague, player_directory: directory }));
    await d.rosterMove({
      leagueId: LEAGUE,
      teamId: 'team-a',
      eventId: 'e1',
      addedPlayerId: 8480069,
      droppedPlayerId: 8478402,
      actorUserId: 'someone-else',
    });
    const own = callsFor('roster_own');
    expect(own[0].body).toBe('Your team added Macklin Celebrini and dropped Connor McDavid.');
  });

  it('does not tell the manager who made the move, but does tell the league', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague, player_directory: directory }));
    await d.rosterMove({
      leagueId: LEAGUE,
      teamId: 'team-a',
      eventId: 'e1',
      addedPlayerId: 8480069,
      actorUserId: 'user-a',
    });
    expect(callsFor('roster_own')).toHaveLength(0);
    expect(callsFor('roster_league').map((c) => c.userIds[0]).sort()).toEqual(['user-b', 'user-c']);
  });

  it('says nothing at all when neither player resolves to a name', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague, player_directory: [] }));
    await d.rosterMove({ leagueId: LEAGUE, teamId: 'team-a', eventId: 'e1', addedPlayerId: 999 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('skipOwn leaves the league announcement but drops the owner copy', async () => {
    const d = new NotificationDispatch(makeSupabase({ teams: teamsInLeague, player_directory: directory }));
    await d.rosterMove({
      leagueId: LEAGUE,
      teamId: 'team-a',
      eventId: 'e1',
      addedPlayerId: 8480069,
      skipOwn: true,
    });
    expect(callsFor('roster_own')).toHaveLength(0);
    expect(callsFor('roster_league').length).toBeGreaterThan(0);
  });
});

describe('waivers', () => {
  it('tells the claiming manager they won, and nobody else under that category', async () => {
    const d = new NotificationDispatch(
      makeSupabase({
        teams: teamsInLeague,
        player_directory: [{ player_id: 1, full_name: 'Drake Batherson' }],
      }),
    );
    await d.waiverResult({ leagueId: LEAGUE, claimId: 'c1', teamId: 'team-a', playerId: 1, won: true });
    const sent = callsFor('waiver_result');
    expect(sent).toHaveLength(1);
    expect(sent[0].userIds).toEqual(['user-a']);
    expect(sent[0].body).toContain('Drake Batherson');
    expect(sent[0].dedupeKey).toBe('waiver_result:c1');
  });

  it('a lost claim carries the reason', async () => {
    const d = new NotificationDispatch(
      makeSupabase({ teams: teamsInLeague, player_directory: [{ player_id: 1, full_name: 'Mark Stone' }] }),
    );
    await d.waiverResult({
      leagueId: LEAGUE,
      claimId: 'c1',
      teamId: 'team-a',
      playerId: 1,
      won: false,
      failureReason: 'Outbid.',
    });
    expect(callsFor('waiver_result')[0].body).toContain('Outbid.');
  });
});

describe('chat', () => {
  const profiles = [
    { id: 'user-b', username: 'screenking' },
    { id: 'user-c', username: 'thirdguy' },
  ];

  it('a mention replaces the bulk copy — never two pushes for one message', async () => {
    const d = new NotificationDispatch(
      makeSupabase({ teams: teamsInLeague, profiles, user_blocks: [] }),
    );
    await d.chatMessage({
      leagueId: LEAGUE,
      messageId: 'm1',
      senderUserId: 'user-a',
      senderName: 'G Daddy',
      message: 'hey @screenking you awake?',
    });

    expect(callsFor('chat_mention').map((c) => c.userIds[0])).toEqual(['user-b']);
    expect(callsFor('chat_all').map((c) => c.userIds[0])).toEqual(['user-c']);
  });

  it('matches a bare name on a word boundary, not a substring', async () => {
    const d = new NotificationDispatch(
      makeSupabase({ teams: teamsInLeague, profiles, user_blocks: [] }),
    );
    await d.chatMessage({
      leagueId: LEAGUE,
      messageId: 'm1',
      senderUserId: 'user-a',
      message: 'screenkingdom is not a person',
    });
    expect(callsFor('chat_mention')).toHaveLength(0);
  });

  it('never notifies the sender', async () => {
    const d = new NotificationDispatch(
      makeSupabase({ teams: teamsInLeague, profiles, user_blocks: [] }),
    );
    await d.chatMessage({ leagueId: LEAGUE, messageId: 'm1', senderUserId: 'user-a', message: 'hello' });
    const everyone = notify.mock.calls.flatMap((c) => c[0].userIds);
    expect(everyone).not.toContain('user-a');
  });

  it('honours a block in either direction', async () => {
    const d = new NotificationDispatch(
      makeSupabase({
        teams: teamsInLeague,
        profiles,
        user_blocks: [{ blocker_id: 'user-b', blocked_id: 'user-a' }],
      }),
    );
    await d.chatMessage({ leagueId: LEAGUE, messageId: 'm1', senderUserId: 'user-a', message: 'hello all' });
    const everyone = notify.mock.calls.flatMap((c) => c[0].userIds);
    expect(everyone).not.toContain('user-b');
    expect(everyone).toContain('user-c');
  });

  it('a blocked manager is not reachable even by an explicit mention', async () => {
    const d = new NotificationDispatch(
      makeSupabase({
        teams: teamsInLeague,
        profiles,
        user_blocks: [{ blocker_id: 'user-a', blocked_id: 'user-b' }],
      }),
    );
    await d.chatMessage({
      leagueId: LEAGUE,
      messageId: 'm1',
      senderUserId: 'user-a',
      message: 'oi @screenking',
    });
    const everyone = notify.mock.calls.flatMap((c) => c[0].userIds);
    expect(everyone).not.toContain('user-b');
  });
});

describe('totality', () => {
  it('does not throw when the database throws', async () => {
    const exploding = {
      from: vi.fn(() => {
        throw new Error('connection reset');
      }),
    } as never;
    const d = new NotificationDispatch(exploding);
    await expect(
      d.tradeOffered({ leagueId: LEAGUE, tradeId: 't1', fromTeamId: 'a', toTeamId: 'b' }),
    ).resolves.toBeUndefined();
    await expect(
      d.chatMessage({ leagueId: LEAGUE, messageId: 'm', senderUserId: 'u', message: 'x' }),
    ).resolves.toBeUndefined();
  });
});
