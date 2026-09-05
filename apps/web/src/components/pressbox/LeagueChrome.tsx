/**
 * THE LEAGUE CHROME, IN ONE PIECE (2026-09-04).
 *
 * Every league screen below `lg` wears the same two things: the Press Box
 * LeagueHeader (crest, name, the week, the sliders, the four sub-tabs)
 * and the LeagueMenu the sliders open. Five pages had assembled the pair
 * by hand — the menu's open state, the profile read for its footer, the
 * `pt-[env(safe-area-inset-top)]` wrapper — and the pages the league menu
 * itself leads to (Waivers, Trades, Schedule, the GM office, another
 * manager's team, the bracket, analytics) still wore the 09-01 chrome: a
 * centred title over a hamburger that opened the OLD menu sheet. Two
 * menus in one app, depending on which screen you stood on.
 *
 * This is the pair as one component, so a page mounts its chrome in one
 * line and the guard that pins "every header opens the menu"
 * (mobileHeaderMenuGuard) sees the same wiring on every page.
 *
 * Render it once, at the top of the phone layer, OUTSIDE any `lg:hidden`
 * wrapper of the page's own: the menu is a fixed overlay and takes care
 * of its own breakpoint.
 */
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLeague } from '@/contexts/LeagueContext';
import { useProfile } from '@/hooks/useProfile';
import { teamCrestUrl } from '@/components/roster/headshot';
import { getLeagueTypeFromSettings, leagueSwitchDestination } from '@/utils/leagueTypeHelpers';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';
import { LeagueHeader, type LeagueHeaderProps } from './LeagueHeader';
import { LeagueMenu, type LeagueMenuProps } from './LeagueMenu';
import { PressBoxLeagueSwitcher } from './LeagueSwitcher';
import type { SwitcherLeague } from './leagueSwitcherRows';
import type { LeagueMenuTile } from './leagueMenuTiles';
import { menuUserFromProfile } from './menuUser';
import { useLeagueMenuTiles } from './useLeagueMenuTiles';

export interface PressBoxLeagueChromeProps extends Omit<LeagueHeaderProps, 'onSettingsPress' | 'className'> {
  /** Tiles beyond the defaults, for a screen that earns one. */
  tiles?: LeagueMenuTile[];
  /**
   * The league the page is showing, when it is not the context's active
   * one: League HQ and the Match page read theirs from the URL and fetch
   * it themselves. The header applies the same rule from `:leagueId`.
   */
  leagueId?: string | null;
  leagueName?: string | null;
  className?: string;
}

export function PressBoxLeagueChrome({ tiles, leagueId, leagueName, className, ...header }: PressBoxLeagueChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const league = useLeague();
  const params = useParams<{ leagueId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: profile } = useProfile();
  // The header is presentational; this is where the league is resolved.
  // The URL's league wins, then the page's, then the context's -- and the
  // crest comes only from the context's league when it IS that league,
  // never a different league's crest beside this one's name.
  const resolvedId = params.leagueId ?? leagueId ?? league?.activeLeagueId ?? '';
  const resolvedName = leagueName ?? league?.activeLeague?.name ?? '';
  const crestSrc = useMemo(() => {
    if (!resolvedId || resolvedId !== league?.activeLeagueId) return null;
    const abbr = (league?.activeLeague?.settings as { crestTeam?: string } | null)?.crestTeam;
    return abbr ? teamCrestUrl(abbr) : null;
  }, [resolvedId, league?.activeLeagueId, league?.activeLeague]);
  // THE SWITCHER (2026-09-05). The league name in the header and the
  // SWITCH ▾ pill in the menu both open one bottom sheet: Create / Join at
  // the top, the manager's leagues under it, the active one marked. A pick
  // goes where the desktop switcher's pick goes (`leagueSwitchDestination`:
  // a pool to its pool route, a Match screen to the other league's Match,
  // everything else to the league's HQ) and makes it the context's active
  // league, so the next cold open lands there. The sheet's foot goes to
  // the league list (`/?all=1`; `/` itself is the active league's HQ).
  const userLeagues: SwitcherLeague[] = league?.userLeagues ?? [];
  const onSwitchLeague = () => {
    setMenuOpen(false);
    setSwitcherOpen(true);
  };
  const onPickLeague = (l: SwitcherLeague) => {
    setSwitcherOpen(false);
    if (l.id === resolvedId) return;
    league?.setActiveLeagueId?.(l.id);
    const lType = getLeagueTypeFromSettings((l.settings as Record<string, unknown> | null | undefined) ?? null);
    navigate(leagueSwitchDestination(l.id, lType, location.pathname));
  };
  const onCreateLeague = () => {
    setSwitcherOpen(false);
    navigate('/create-league');
  };
  const onAllLeagues = () => {
    setSwitcherOpen(false);
    navigate('/?all=1');
  };
  return (
    <>
      {/* THE WRAPPER IS THE STICKY ELEMENT (2026-09-05, from a phone
          screenshot of the Team screen scrolled under the status bar). The
          header's own `sticky` could never leave a wrapper exactly its own
          height, so it scrolled away with the page and the content slid
          under the clock. Sticky here, with the safe-area padding painted in
          surface, keeps the league name and the four tabs on screen. */}
      <div
        className={cn(PB_TYPE, 'lg:hidden sticky top-0 z-app-nav bg-pressbox-surface pt-[env(safe-area-inset-top)]', className)}
        data-testid="pb-league-chrome"
      >
        <LeagueHeader
          {...header}
          leagueId={resolvedId || null}
          leagueName={resolvedName}
          crestSrc={crestSrc}
          onSettingsPress={() => setMenuOpen(true)}
          onLeaguePress={() => setSwitcherOpen(true)}
        />
      </div>
      {switcherOpen && (
        <PressBoxLeagueSwitcher
          open
          onOpenChange={setSwitcherOpen}
          leagues={userLeagues}
          activeId={resolvedId || null}
          onPick={onPickLeague}
          onCreate={onCreateLeague}
          onAllLeagues={onAllLeagues}
        />
      )}
      {/* The menu exists only while open (2026-09-05): its lines are
          react-query reads, and mounting the hook on every league page put
          `useQuery` under page tests that render no QueryClient. A page
          that hands its own tiles keeps them. */}
      {menuOpen && (tiles ? (
        <LeagueMenu
          open
          onClose={() => setMenuOpen(false)}
          leagueId={resolvedId}
          leagueName={resolvedName}
          tiles={tiles}
          user={menuUserFromProfile(profile)}
          onSwitchLeague={onSwitchLeague}
        />
      ) : (
        <LeagueMenuWithReads
          onClose={() => setMenuOpen(false)}
          leagueId={resolvedId}
          leagueName={resolvedName}
          user={menuUserFromProfile(profile)}
          onSwitchLeague={onSwitchLeague}
        />
      ))}
    </>
  );
}

/** The menu with its lines: the reads live here, under the open menu only. */
function LeagueMenuWithReads(props: Omit<LeagueMenuProps, 'open' | 'tiles'>) {
  const tiles = useLeagueMenuTiles(props.leagueId, true);
  return <LeagueMenu open tiles={tiles} {...props} />;
}

export default PressBoxLeagueChrome;
