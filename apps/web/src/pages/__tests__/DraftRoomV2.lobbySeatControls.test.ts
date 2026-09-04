/**
 * THE LOBBY CAN NAME A TEAM AND OPEN A SEAT (2026-09-04).
 *
 * Two gaps found in the Tuesday-funnel sweep, four days before twelve real
 * managers draft:
 *
 * 1. Nothing in the product ever asks for a team name. `handle_new_user`
 *    mints `user_a3f9c1`; `requireProfile` exists on ProtectedRoute and no
 *    route passes it, so /profile-setup is unreachable; and landing on an
 *    invite link auto-joins 50ms after the session resolves, so the join
 *    tab's team-name box is never seen. Production on the day: 8 of 72
 *    profiles had a real username, and the live team-name histogram already
 *    read "My Team x5, Team 1 x3, Team 2 x4".
 *
 * 2. AI fill was one-way from inside the app. The DELETE endpoint, its
 *    client wrapper and its commissioner check all existed; only the v1
 *    lobby ever called it, and v1 was fenced off on 2026-08-18. Fill the
 *    room, have a friend arrive late, and there was no way to make room.
 *
 * Both now live on the lobby seat row, which is the one screen where
 * everyone is sitting still with nothing to do.
 *
 * Source contracts: DraftRoomV2 is a 5,000-line page behind a WebSocket
 * runner and a latched pre-ignition signal. Mounting it to assert a button
 * would test the mock harness.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOM = readFileSync(resolve(here, '../DraftRoomV2.tsx'), 'utf-8');

describe('a manager can name their own team from the lobby', () => {
  it('offers the rename only on the seat that is theirs', () => {
    expect(ROOM).toContain('data-testid="lobby-rename-open"');
    expect(ROOM).toContain('data-testid="lobby-rename-input"');
    expect(ROOM).toContain('data-testid="lobby-rename-save"');
    // Gated on isMine, not on commissioner and not on everyone.
    expect(ROOM).toMatch(/isMine && \(\s*<button[\s\S]{0,400}lobby-rename-open/);
  });

  it('writes through the endpoint Profile already uses', () => {
    // Not a direct table write from the client: the endpoint sets
    // default_team_name AND syncs every team the user owns, which is what
    // makes the name stick for the next league too.
    expect(ROOM).toContain('LeagueService.updateUserTeamNames');
  });

  it('escape and enter both work, because this is a phone', () => {
    expect(ROOM).toMatch(/e\.key === 'Enter'/);
    expect(ROOM).toMatch(/e\.key === 'Escape'/);
  });

  it('refreshes the room after a rename rather than trusting local state', () => {
    const at = ROOM.indexOf('const saveTeamName');
    expect(at).toBeGreaterThan(-1);
    const body = ROOM.slice(at, ROOM.indexOf('const removeAiTeam'));
    expect(body).toContain('onRetryTeams()');
    // A failed rename has to say so; the whole point is that the name is
    // visible to eleven other people.
    expect(body).toContain('toast.error');
  });
});

describe('a commissioner can open a seat again', () => {
  it('offers removal only on AI seats, and only to the commissioner', () => {
    expect(ROOM).toContain('data-testid="lobby-remove-ai"');
    expect(ROOM).toMatch(/!t\.owner_id && isCommissioner/);
  });

  it('calls the endpoint that already existed rather than writing teams directly', () => {
    const at = ROOM.indexOf('const removeAiTeam');
    expect(at).toBeGreaterThan(-1);
    const body = ROOM.slice(at, at + 900);
    expect(body).toContain('leagueApi.deleteTeam');
    expect(body).toContain('onRetryTeams()');
    expect(body).toContain('toast.error');
  });

  it('cannot be double-fired while a removal is in flight', () => {
    expect(ROOM).toMatch(/disabled=\{removingTeamId === t\.id\}/);
  });
});

describe('the hooks stay above the lobby early return', () => {
  it('declares seat-control state before `if (!waitingForStart) return null`', () => {
    // DraftLobbyV2 returns null when it is not the pre-ignition lobby. State
    // declared after that line is a conditional hook, which React will not
    // forgive and which eslint caught once already.
    const earlyReturn = ROOM.indexOf('if (!waitingForStart) return null;');
    expect(earlyReturn).toBeGreaterThan(-1);
    for (const hook of [
      'const [renamingTeamId',
      'const [renameValue',
      'const [renameSaving',
      'const [removingTeamId',
    ]) {
      const at = ROOM.indexOf(hook);
      expect(at, `${hook} is missing`).toBeGreaterThan(-1);
      expect(at, `${hook} is declared after the early return`).toBeLessThan(earlyReturn);
    }
  });
});
