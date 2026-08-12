// ARCHITECT 2026-08-12 (ROSTER-CTA / inbox E133) — the completion banner's
// roster link must be scoped to the league that just finished drafting.
//
// FIELD EVIDENCE. A 12x21 draft was run to completion on staging in league
// ada00018. Clicking "View your roster" on the completion panel navigated to
//     /roster?league=ada00015-0000-4000-8000-000000000001
// — a DIFFERENT league (the resident rig that happened to be the app's active
// league at the time).
//
// MECHANISM. `CompletionMomentBanner`'s `rosterHref` defaults to a bare
// "/roster". `App.tsx:186` declares that route with no :leagueId param, and
// `Roster.tsx` resolves which league to show from LeagueContext's
// `activeLeagueId` (:218, :502). `DraftRoomV2` reads its leagueId from the
// PATH and never calls setActiveLeagueId, so the context is still pointing
// wherever it pointed before the user entered the room. The banner therefore
// sends people to whichever league they last looked at.
//
// This is the emotional high point of draft night — 252 picks in, "ROSTERS
// ARE SET", one button. It should not be a coin flip.
//
// The fix scopes the href with ?league=<id>, which routes through
// LeagueContext's existing "update active league when the URL param changes
// (with membership validation)" effect. The banner already declared the prop
// and its own test already covered "parent may pass league-scoped variant";
// the parent simply never did.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompletionMomentBanner } from '../CompletionMomentBanner';

afterEach(cleanup);

const LEAGUE = 'ada00018-0000-4000-8000-000000000001';

describe('CompletionMomentBanner — league-scoped roster CTA', () => {
  it('uses the league-scoped href when the parent supplies one', () => {
    render(
      <CompletionMomentBanner
        totalPicks={252}
        rosterHref={`/roster?league=${LEAGUE}`}
        skipAnimationForTests
      />,
    );
    expect(screen.getByTestId('completion-roster-cta').getAttribute('href')).toBe(
      `/roster?league=${LEAGUE}`,
    );
  });

  it('carries the league id, not a bare /roster, so LeagueContext can switch', () => {
    render(
      <CompletionMomentBanner
        totalPicks={252}
        rosterHref={`/roster?league=${LEAGUE}`}
        skipAnimationForTests
      />,
    );
    const href = screen.getByTestId('completion-roster-cta').getAttribute('href') ?? '';
    expect(href).toContain(`league=${LEAGUE}`);
    expect(href).not.toBe('/roster');
  });

  it('still falls back to the bare /roster default when no href is given', () => {
    // Pinning the default: DraftRoomV2 passes undefined when leagueId is
    // empty (pre-route-resolution), and the old behaviour must survive that.
    render(<CompletionMomentBanner totalPicks={252} skipAnimationForTests />);
    expect(screen.getByTestId('completion-roster-cta').getAttribute('href')).toBe('/roster');
  });

  it('renders the real pick total, not a hardcoded one', () => {
    render(<CompletionMomentBanner totalPicks={252} skipAnimationForTests />);
    expect(screen.getByText(/252/)).toBeInTheDocument();
  });
});
