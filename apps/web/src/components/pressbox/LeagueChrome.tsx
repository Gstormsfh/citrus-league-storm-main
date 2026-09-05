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
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLeague } from '@/contexts/LeagueContext';
import { useProfile } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';
import { LeagueHeader, type LeagueHeaderProps } from './LeagueHeader';
import { LeagueMenu } from './LeagueMenu';
import type { LeagueMenuTile } from './leagueMenuTiles';
import { menuUserFromProfile } from './menuUser';

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
  const league = useLeague();
  const params = useParams<{ leagueId?: string }>();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  return (
    <>
      <div className={cn(PB_TYPE, 'lg:hidden pt-[env(safe-area-inset-top)]', className)}>
        <LeagueHeader {...header} onSettingsPress={() => setMenuOpen(true)} />
      </div>
      <LeagueMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        leagueId={leagueId ?? params.leagueId ?? league?.activeLeagueId ?? ''}
        leagueName={leagueName ?? league?.activeLeague?.name ?? ''}
        tiles={tiles}
        user={menuUserFromProfile(profile)}
        /* SWITCH ▾ goes to the LEAGUES tab, which lists them: the artboard's
           home is the league switcher, and one list beats a second picker. */
        onSwitchLeague={() => {
          setMenuOpen(false);
          navigate('/');
        }}
      />
    </>
  );
}

export default PressBoxLeagueChrome;
