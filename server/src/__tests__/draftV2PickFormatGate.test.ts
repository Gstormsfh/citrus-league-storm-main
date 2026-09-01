/**
 * AUCTION FORMAT GATE (2026-09-01) — league a1a125c8, seq 2: a Draft
 * press in an auction room recorded a $0 snake pick through this HTTP
 * route, because only the engine's WS path carried the format gate.
 * Contract: the pick route refuses auction-format leagues before the
 * RPC is ever called, and the guard reads the league's draftType.
 *
 * jsdom-free source contract — the route's behavior is covered
 * end-to-end by the existing route suites; this pins the gate's
 * presence and ordering so a refactor cannot quietly drop it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTE = readFileSync(resolve(here, '../routes/draftV2Pick.ts'), 'utf-8');

describe('the HTTP pick route refuses auction lobbies', () => {
  it('gates on the league draftType before submitting', () => {
    const gate = ROUTE.indexOf("draftType === 'auction'");
    const submit = ROUTE.indexOf('service.submitPick({');
    expect(gate, 'format gate missing from pick route').toBeGreaterThan(-1);
    expect(submit).toBeGreaterThan(-1);
    expect(gate, 'the gate must run before submitPick').toBeLessThan(submit);
  });

  it('answers 409 wrong_format_for_action', () => {
    const gateRegion = ROUTE.slice(
      ROUTE.indexOf("draftType === 'auction'"),
      ROUTE.indexOf('service.submitPick({'),
    );
    expect(gateRegion).toContain('wrong_format_for_action');
    expect(gateRegion).toContain('409');
  });
});
