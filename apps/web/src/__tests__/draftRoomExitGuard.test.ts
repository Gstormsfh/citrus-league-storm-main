/**
 * DRAFT ROOM ESCAPE HATCH (2026-08-31) — reported from the iOS simulator
 * as "I got stuck on the waiting-for-the-draft-room page; the menu has
 * disappeared."
 *
 * The draft routes hide the app's global navigation on purpose (the
 * bottom nav's hideRoutes list covers /draft, /draft-v2, /draft-room so
 * the room owns the whole screen during a live draft). On the web that is
 * survivable — the browser has a back button. In the native shell there
 * is no browser chrome, so a draft page without its own exit is a dead
 * end the user can only leave by killing the app.
 *
 * The invariant: the v2 room renders an exit back to League HQ in every
 * branch that owns the screen — the live/lobby room and the offline
 * results room. jsdom has no layout engine; these are source contracts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, '../pages/DraftRoomV2.tsx'), 'utf-8');

describe('the v2 draft room always carries its own way out', () => {
  it('renders an exit link in every full-screen branch', () => {
    const exits = SOURCE.match(/data-testid="draft-room-exit"/g) ?? [];
    expect(exits.length, 'both the live room and the offline room need an exit').toBeGreaterThanOrEqual(2);
  });

  it('points the exit at League HQ', () => {
    const targets = SOURCE.match(/to=\{`\/league\/\$\{leagueId\}`\}/g) ?? [];
    expect(targets.length).toBeGreaterThanOrEqual(2);
  });

  it('uses a client-side Link, not a full page reload', () => {
    expect(SOURCE).toMatch(/import \{ Link, useParams \} from 'react-router-dom'/);
  });

  it('keeps the global nav hidden on draft routes — the exit is the escape, not the nav coming back', () => {
    const nav = readFileSync(resolve(here, '../components/MobileBottomNav.tsx'), 'utf-8');
    expect(nav).toMatch(/'\/draft-v2'/);
  });
});
