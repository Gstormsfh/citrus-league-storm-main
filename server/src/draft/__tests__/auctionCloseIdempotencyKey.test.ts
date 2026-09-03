// LOT-CLOSE IDEMPOTENCY KEY (2026-09-01, league a1a125c8).
//
// The auction draft died at its first lot close. The engine's
// bid-window timer fired on time (2026-09-01T17:16:23.027Z, exactly
// `auction_nominations.expires_at`) and called `close_nomination_v2`
// with `idempotencyKey: 'close-<nominationId>'`. That RPC's
// `p_idempotency_key` parameter is typed `uuid`, so Postgres raised
// 22P02 "invalid input syntax for type uuid" and the call threw.
// `handleNominationTimeout`'s catch then cleared `currentNomination`
// and `currentTimerDeadline`, armed no successor timer and wrote no
// durable event: one nomination in the log, then silence forever.
//
// The failure was DETERMINISTIC, so the one-shot retry wrapper added
// the same day could not absorb it. What fixes it is the key SHAPE.
//
// Contract pinned here: every idempotency key the engine hands to a
// draft RPC must be a value Postgres will accept as `uuid`.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOBBY = readFileSync(resolve(here, '../LobbyManager.ts'), 'utf-8');

// Postgres accepts any 32 hex digits in 8-4-4-4-12 layout; it does
// not validate the RFC version nibble. This is the acceptance test
// the `uuid` input function actually applies.
const PG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirror of LobbyManager's module-private `md5UuidFromSeed`.
function md5UuidFromSeed(seed: string): string {
  const hex = createHash('md5').update(seed).digest('hex');
  return (
    hex.slice(0, 8) + '-' +
    hex.slice(8, 12) + '-' +
    hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' +
    hex.slice(20, 32)
  );
}

function closeWrapperBody(): string {
  const at = LOBBY.indexOf('private async closeNominationWithRetry');
  expect(at, 'closeNominationWithRetry not found').toBeGreaterThan(-1);
  return LOBBY.slice(at, at + 2600);
}

describe('the lot close is keyed on something Postgres can cast to uuid', () => {
  it('does not hand the RPC a prefixed non-uuid string', () => {
    const body = closeWrapperBody();
    expect(
      body.includes('idempotencyKey: `close-${nominationId}`'),
      'a `close-<uuid>` literal is not a uuid; close_nomination_v2 rejects it with 22P02',
    ).toBe(false);
  });

  it('derives the key so it is uuid-shaped and stable across the retry', () => {
    const body = closeWrapperBody();
    expect(body).toContain('md5UuidFromSeed(`close:${nominationId}`)');
    // One derivation, shared by both attempts: the retry must reuse
    // the first attempt's key or a committed first attempt would be
    // re-applied as a second, distinct close.
    expect((body.match(/idempotencyKey:/g) ?? []).length).toBe(1);
    expect((body.match(/return await call\(\);/g) ?? []).length).toBe(2);
  });

  it('the derived key passes the cast that rejected the old one', () => {
    const nominationId = 'a207306d-a2d5-4ad8-8c7d-60e0de8648a2';
    expect(`close-${nominationId}`).not.toMatch(PG_UUID);
    expect(md5UuidFromSeed(`close:${nominationId}`)).toMatch(PG_UUID);
  });

  it('is deterministic, so a re-close collapses onto the first result', () => {
    const nominationId = 'a207306d-a2d5-4ad8-8c7d-60e0de8648a2';
    expect(md5UuidFromSeed(`close:${nominationId}`)).toBe(
      md5UuidFromSeed(`close:${nominationId}`),
    );
    expect(md5UuidFromSeed(`close:${nominationId}`)).not.toBe(
      md5UuidFromSeed('close:00000000-0000-0000-0000-000000000000'),
    );
  });
});

describe('no other engine-authored draft RPC key is a raw prefixed string', () => {
  it('every idempotencyKey literal in LobbyManager is a uuid or a uuid derivation', () => {
    // Matches `idempotencyKey: <expr>,` and keeps the expression.
    const offenders: string[] = [];
    for (const m of LOBBY.matchAll(/idempotencyKey:\s*([^\n]+?),\s*$/gm)) {
      const expr = m[1].trim();
      const ok =
        expr.startsWith('action.idempotencyKey') ||
        expr.startsWith('params.idempotencyKey') ||
        expr.startsWith('idemKey') ||
        expr.startsWith('randomUUID()') ||
        expr.startsWith('md5UuidFromSeed(');
      if (!ok) offenders.push(expr);
    }
    expect(offenders, 'non-uuid idempotency key handed to a draft RPC').toEqual([]);
  });
});
