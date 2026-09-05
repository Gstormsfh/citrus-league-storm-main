/**
 * PRESS BOX BOTTOM NAV — app-level, five tabs (2026-09-04).
 *
 * Replaces the current five-tab league nav. The split is the point: this bar
 * moves you around the APP; `LeagueHeader`'s sub-tab strip moves you around a
 * LEAGUE. The old bar tried to do both, which is how a playoff-pool manager
 * ended up with four tabs that all led back into the pool and no way out.
 *
 * Deliberately NOT reading LeagueContext. Every destination here is
 * league-independent, so a nav that re-rendered on league switch would be
 * doing work to produce the same five links. It also means this component
 * cannot be the thing that traps someone inside a league.
 *
 * `calendar-range` in the spec is `Calendar` here: the repo's lucide version
 * ships `Calendar` and I could not confirm `CalendarRange` without adding a
 * dependency risk at 4am. Same silhouette at 20px. Logged in PROGRESS.md.
 */
import { NavLink, useLocation } from 'react-router-dom';
import { Trophy, Calendar, TrendingUp, BarChart3, CircleUser } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BOTTOMNAV_H } from './chromeMetrics';
import { PB_TYPE } from './rowScale';

const TABS = [
  { to: '/', label: 'Leagues', Icon: Trophy, end: true },
  { to: '/scores', label: 'Scores', Icon: Calendar, end: false },
  { to: '/players', label: 'Players', Icon: TrendingUp, end: false },
  { to: '/news', label: 'News', Icon: BarChart3, end: false },
  { to: '/profile', label: 'Account', Icon: CircleUser, end: false },
] as const;

/**
 * LEAGUES is lit on every league screen (2026-09-04). `end` on `/` made it
 * active on the home list alone, so a manager on Standings or the Match
 * screen saw five dim tabs — the artboard lights LEAGUES there, because a
 * league is where you are. The other four own their prefixes; everything
 * that is not one of them belongs to LEAGUES.
 */
const OTHER_PREFIXES = ['/scores', '/players', '/news', '/profile'];

export function PressBoxBottomNav({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const leaguesActive = !OTHER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // `/` opens the active league's HQ (2026-09-05). From inside a league,
  // LEAGUES is the way to the list of them, so a second tap goes there.
  const leaguesTo = leaguesActive && pathname !== '/' ? '/?all=1' : '/';
  return (
    <nav
      aria-label="Main"
      className={cn(
        PB_TYPE,
        'fixed bottom-0 left-0 right-0 z-app-nav lg:hidden',
        'bg-pressbox-surface border-t border-white/[0.08]',
        'pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      <ul className="grid grid-cols-5" style={{ height: BOTTOMNAV_H }}>
        {TABS.map(({ to, label, Icon, end }) => (
          <li key={to} className="contents">
            <NavLink
              to={to === '/' ? leaguesTo : to}
              end={end}
              aria-current={to === '/' && leaguesActive ? 'page' : undefined}
              className={({ isActive }) =>
                cn(
                  'focus-citrus flex flex-col items-center justify-center gap-1.5 min-h-[44px]',
                  // Active is colour only. The spec is explicit that there is
                  // no filled square behind it: a filled tab is a second
                  // saturated shape competing with the one orange element the
                  // screen is allowed.
                  (to === '/' ? leaguesActive : isActive) ? 'text-pressbox-orange-soft' : 'text-pressbox-text/45',
                )
              }
            >
              <Icon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
              <span className="font-plex font-semibold text-[10px] uppercase tracking-[0.06em]">
                {label}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default PressBoxBottomNav;
