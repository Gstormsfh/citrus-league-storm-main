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

describe('the snake clock never runs in an auction lobby', () => {
  it('armPickDeadline carries the format fence', () => {
    const fnAt = LOBBY.indexOf('private armPickDeadline');
    expect(fnAt).toBeGreaterThan(-1);
    const body = LOBBY.slice(fnAt, fnAt + 1400);
    const fence = body.indexOf("this.format === 'auction'");
    const arm = body.indexOf('setPickDeadline');
    expect(fence, 'auction fence missing from armPickDeadline').toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(-1);
    expect(fence, 'the fence must run before any arm').toBeLessThan(arm);
  });
});

describe('a lot close survives one transient failure', () => {
  it('handleNominationTimeout closes through the retry wrapper', () => {
    const timeoutAt = LOBBY.indexOf('private async handleNominationTimeout');
    const body = LOBBY.slice(timeoutAt, timeoutAt + 1200);
    expect(body).toContain('closeNominationWithRetry');
  });

  it('the wrapper retries exactly once on the same idempotency key', () => {
    const wrapAt = LOBBY.indexOf('private async closeNominationWithRetry');
    expect(wrapAt).toBeGreaterThan(-1);
    const body = LOBBY.slice(wrapAt, wrapAt + 1600);
    expect(body).toContain('retrying once');
    expect((body.match(/idempotencyKey: `close-\$\{nominationId\}`/g) ?? []).length).toBe(1);
    expect(body).toContain('return await call();');
  });
});
