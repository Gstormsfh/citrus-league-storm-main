/**
 * AUCTION SNAKE-BLEED GUARD (2026-09-01) — league a1a125c8: the snake
 * pipeline ran underneath a live auction. Seq 4 was a snake AUTOPICK
 * fired into an auction lobby because draft_started's
 * first_pick_deadline armed the pick clock regardless of format; and
 * when the lot close later threw, the engine cleared its nomination
 * silently — no durable event — so clients froze at 0s.
 *
 * Contracts pinned here:
 *  1. armPickDeadline (the enforced single arm entry point, E113)
 *     refuses auction lobbies.
 *  2. Lot close runs through a one-retry wrapper keyed on the same
 *     idempotency key, so a transient RPC failure cannot wedge the
 *     room.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOBBY = readFileSync(resolve(here, '../draft/LobbyManager.ts'), 'utf-8');

/**
 * The source of one class method: from its declaration to the next member
 * declaration at class indentation. A fixed character window did this job
 * until 2026-09-03, when a root-cause comment inside closeNominationWithRetry
 * pushed the line under test past offset 1600 and the guard went red on a
 * body that satisfied every contract it pins. Comments are allowed to grow;
 * the extraction has to follow the code, not a byte count.
 */
function methodSource(marker: string): string {
  const at = LOBBY.indexOf(marker);
  expect(at, `${marker} not found in LobbyManager.ts`).toBeGreaterThan(-1);
  const rest = LOBBY.slice(at + marker.length);
  const next = rest.search(/\n {2}(?:private|public|protected|static|readonly|async|get|set) [A-Za-z_]/);
  return next === -1 ? LOBBY.slice(at) : LOBBY.slice(at, at + marker.length + next);
}

describe('the snake clock never runs in an auction lobby', () => {
  it('armPickDeadline carries the format fence', () => {
    const body = methodSource('private armPickDeadline');
    const fence = body.indexOf("this.format === 'auction'");
    const arm = body.indexOf('setPickDeadline');
    expect(fence, 'auction fence missing from armPickDeadline').toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(-1);
    expect(fence, 'the fence must run before any arm').toBeLessThan(arm);
  });
});

describe('a lot close survives one transient failure', () => {
  it('handleNominationTimeout closes through the retry wrapper', () => {
    const body = methodSource('private async handleNominationTimeout');
    expect(body).toContain('closeNominationWithRetry');
  });

  it('the wrapper retries exactly once on the same idempotency key', () => {
    const body = methodSource('private async closeNominationWithRetry');
    expect(body).toContain('retrying once');
    // 2026-09-03: the key was a prefixed literal fed to a `uuid` RPC
    // parameter, so close_nomination_v2 raised 22P02 and the auction died
    // after one nomination. It is now derived, and still deterministic so
    // the retry replays onto the same idempotency row.
    expect((body.match(/idempotencyKey: md5UuidFromSeed\(`close:\$\{nominationId\}`\)/g) ?? []).length).toBe(1);
    expect(body).toContain('return await call();');
  });
});
