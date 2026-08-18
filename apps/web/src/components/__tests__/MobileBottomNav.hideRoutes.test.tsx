// ARCHITECT 2026-08-11 (DESIGN_LOBBY_CAMPAIGN L4 / inbox E123) —
// MobileBottomNav route-hide contract.
//
// WHY THIS TEST EXISTS
// MobileBottomNav is mounted GLOBALLY in App.tsx (line 251), outside the
// <Routes> tree, so it renders on every page unless it opts out itself. Its
// wrapper is `fixed bottom-0 left-0 right-0 z-50 lg:hidden` over an h-16 row:
// a 64px opaque bar at z-index 50 on every viewport under 1024px, which is
// every phone and most tablets. DraftRoomV2 adds no compensating bottom
// padding, so anything the nav overlaps is simply covered.
//
// For three days that bar rendered across the bottom of the draft room. The
// source comment said "Don't show on auth pages, draft room, or setup flows"
// but the array held only auth/setup paths — the draft room was never in it.
// Confirmed live on staging (/draft-v2/ada00013-..., innerWidth 958): nav
// present, rect height 65, z-index 50, covering the pick-history table.
//
// THE TWELVE draft on phones. This test is the durable ledger of the fix: if
// a future edit re-orders, prunes, or "tidies" hideOnRoutes and a draft path
// falls out, this fails immediately rather than at 8pm on draft night.
//
// The positive controls at the bottom matter as much as the negatives — they
// prove the nav is capable of rendering in this harness, so a green suite
// can't be produced by a component that never mounts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Contexts are mocked rather than provided: this test is about routing, and
// real providers would drag in Supabase. Shapes match what the component
// reads — auth?.user and league?.activeLeagueId / activeLeague / activeLeagueFormat.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('@/contexts/LeagueContext', () => ({
  useLeague: () => ({
    activeLeagueId: 'league-1',
    activeLeague: { settings: {} },
    activeLeagueFormat: { leagueType: 'fantasy' },
  }),
}));

import MobileBottomNav from '../MobileBottomNav';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileBottomNav />
    </MemoryRouter>,
  );

// A rendered nav is the single <nav> landmark this component returns; its
// absence == the component returned null. Structural, not label-based:
// the old Profile-tab detector broke when the fantasy branch replaced the
// Profile tab with league tabs (REGULAR-SEASON NAV 2026-08-17), and tab
// labels are expected to keep evolving — the route-hide contract is not.
const navIsRendered = () => document.querySelector('nav') !== null;

afterEach(cleanup);

describe('MobileBottomNav — hidden on every draft route (L4)', () => {
  // Routes as declared in App.tsx: :199 /draft-room, :200 /draft,
  // :202 /draft-v2/:leagueId/:draftId?
  const draftPaths = [
    '/draft-v2/ada00013-0000-4000-8000-000000000001',
    '/draft-v2/ada00013-0000-4000-8000-000000000001/d1',
    '/draft-v2/some-league?league=abc',
    '/draft-room',
    '/draft',
  ];

  it.each(draftPaths)('renders nothing at %s', (path) => {
    renderAt(path);
    expect(navIsRendered()).toBe(false);
  });

  it('covers the v2 room specifically — the surface THE TWELVE use', () => {
    renderAt('/draft-v2/ada00013-0000-4000-8000-000000000001');
    // No fixed-position bar of any kind may exist on this route.
    expect(document.querySelector('nav')).toBeNull();
  });
});

describe('MobileBottomNav — still hidden on the original auth/setup routes', () => {
  const authPaths = ['/auth', '/profile-setup', '/verify-email', '/reset-password'];

  it.each(authPaths)('renders nothing at %s', (path) => {
    renderAt(path);
    expect(navIsRendered()).toBe(false);
  });
});

describe('MobileBottomNav — positive controls (the nav CAN render here)', () => {
  // Without these, every assertion above would pass for a component that
  // simply never mounts in this harness.
  const visiblePaths = ['/', '/news', '/league/league-1', '/nhl/playoffs'];

  it.each(visiblePaths)('renders the nav at %s', (path) => {
    renderAt(path);
    expect(navIsRendered()).toBe(true);
    expect(document.querySelector('nav')).not.toBeNull();
  });

  it('does not treat a non-draft path that merely contains "draft" as a draft route', () => {
    // startsWith is prefix-anchored; a nested path must not accidentally hide.
    renderAt('/news/mock-draft-roundup');
    expect(navIsRendered()).toBe(true);
  });
});
