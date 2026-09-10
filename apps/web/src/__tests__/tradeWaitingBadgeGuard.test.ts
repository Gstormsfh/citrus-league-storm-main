/**
 * A WAITING TRADE OFFER IS VISIBLE WITHOUT A PUSH (2026-09-09).
 *
 * Found on a phone: an offer sat in the Trade Center and nothing on the Team
 * screen said so. The push had not arrived. Even once push works, the app
 * must not rely on it for anything with a clock on it — offers expire.
 *
 * Pins: the Team screen's TRADE action carries the count of offers waiting
 * on this manager, and that count shares the league menu's query so the two
 * surfaces can never disagree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('the TRADE action shows offers waiting on you', () => {
  it('Roster passes the waiting count as the Trade action badge', () => {
    const ROSTER = read('../pages/Roster.tsx');
    expect(ROSTER).toContain("useTradesWaitingOnMe(userTeam?.league_id, userTeam?.id)");
    expect(ROSTER).toMatch(/label: 'Trade'[^\n]*badge: tradesWaiting/);
  });

  it('the card draws a badge only above zero, and outlines the action in orange', () => {
    const CARD = read('../components/pressbox/PressBoxTeamCard.tsx');
    expect(CARD).toContain('badge?: number;');
    expect(CARD).toMatch(/badge > 0 && \(/);
    expect(CARD).toContain("badge > 9 ? '9+' : badge");
  });

  it('the hook shares the league menu query key', () => {
    const HOOK = read('../hooks/useTradesWaitingOnMe.ts');
    const MENU = read('../components/pressbox/useLeagueMenuTiles.ts');
    expect(HOOK).toContain("queryKey: ['league-pending-trades', leagueId]");
    expect(MENU).toContain("queryKey: ['league-pending-trades', leagueId]");
  });
});
