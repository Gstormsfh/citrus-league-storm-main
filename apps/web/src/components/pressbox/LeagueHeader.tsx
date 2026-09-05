/**
 * LEAGUE HEADER — Press Box shared chrome (2026-09-04).
 *
 * Replaces the per-page sticky headers. Two rows, sticky, on every league
 * page: identity on top, navigation under it.
 *
 * WHY THE SUB-TAB STRIP EXISTS AT ALL. Before this, league navigation lived
 * in the five-tab bottom nav, which meant the bottom nav had two jobs -- move
 * between leagues and move within one -- and did neither cleanly. The
 * playoff-pool trap fixed on the same day was a symptom: the pool tab sets
 * had no route out of the pool, because "out" and "across" were the same
 * control. Press Box splits them. The bottom nav is app-level (Leagues,
 * Scores, Players, News, Account); this strip is league-level (Match, Team,
 * Players, League). A tab bar that answers one question is legible; one that
 * answers two is a maze.
 *
 * The week label is a PROP, not a fetch. Chrome that fetches is chrome that
 * flickers on every route change, and the screens already hold the current
 * matchup -- see `useLeagueChrome` when a screen has nothing to pass.
 *
 * PRESENTATIONAL (2026-09-04, after the test run). The league's id, name
 * and crest are props too, resolved by `PressBoxLeagueChrome` from the
 * context. This file used to read the league context itself, and because the
 * `@/components/pressbox` barrel exports it, every component that imported
 * a row from the barrel pulled LeagueContext -> AuthContext -> the Supabase
 * client, which throws at module scope under the hermetic test env: two
 * matchup suites could not load. Chrome that reads no context can be
 * imported anywhere.
 */
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HEADER_ROW1_H, HEADER_SUBTAB_H, SCANLINE } from './chromeMetrics';
import { PB_TYPE } from './rowScale';

export interface LeagueHeaderProps {
  /**
   * The league the header names. `PressBoxLeagueChrome` resolves these from
   * the context; the URL's `:leagueId` still wins over `leagueId` here.
   */
  leagueId?: string | null;
  leagueName?: string | null;
  /** The crest image, already resolved to a URL. Absent draws the initial. */
  crestSrc?: string | null;
  /** `WK 1 · SEP 28–OCT 4`. Omitted while the week is still loading. */
  weekLabel?: string | null;
  /** Tap target for the week label — the week picker. Omit to render it inert. */
  onWeekPress?: () => void;
  /**
   * MATCHUP PAGE (2026-09-04): `‹ WK 1 ›`. The artboard's Match screen
   * steps weeks from the header, and the chevrons draw only when a
   * handler is given — a disabled one at the season's ends.
   */
  onWeekPrev?: (() => void) | null;
  onWeekNext?: (() => void) | null;
  /**
   * The sliders icon. League settings is a SHEET inside LeagueDashboard, not
   * a route (`leagueSettingsMobileSheetGuard` pins that), so there is no
   * `/league/:id/settings` to link to and inventing one would fail
   * linkGraphIntegrity. Screens that own the sheet pass its opener; anywhere
   * else the icon takes the manager to League HQ, where the sheet lives.
   */
  onSettingsPress?: () => void;
  /**
   * THE LEAGUE NAME IS THE SWITCHER (2026-09-05). Reported from the phone:
   * "the league drop down doesn't work any longer with the new visuals —
   * click the dropdown and nothing happens, I can't create a new league."
   * The old mobile navbar's league pill opened My Leagues with Create /
   * Join at the top; here the name linked to the HQ you were already on.
   * With an opener the crest-and-name is a button with a chevron and
   * opens the switcher sheet; without one (a page that resolves no
   * leagues) it stays a link to the league's HQ.
   */
  onLeaguePress?: () => void;
  /**
   * Draw the four-column sub-tab strip. OFF on a screen that already carries
   * its own strip: the Roster page has Roster / Stats / Analytics /
   * Transactions, which is a different axis from Match / Team / Players /
   * League, and two condensed underline strips stacked on one phone is a
   * navigation puzzle rather than a header. The identity row is what that
   * screen needs from this component.
   */
  showSubTabs?: boolean;
  className?: string;
}

type SubTab = { key: string; label: string; to: (leagueId: string) => string; match: (p: string) => boolean };

/**
 * Four equal columns. `match` is deliberately a predicate rather than a
 * prefix compare: Roster and Free Agents carry the league in the QUERY
 * (`/roster?league=`), so a pathname prefix is the whole answer for them,
 * while Match and League carry it in the PATH.
 */
// The league menu's destinations light LEAGUE (2026-09-04): Waivers, Trades,
// Schedule, the GM office, the bracket and another manager's team are all
// reached from it, and the tab that opened a screen is the tab that stays
// lit. Your own analytics is TEAM.
const LEAGUE_PATHS = ['/league', '/standings', '/waiver-wire', '/trade-analyzer', '/schedule-manager', '/gm-office', '/team/'];
const SUB_TABS: SubTab[] = [
  { key: 'match', label: 'Match', to: (id) => `/matchup/${id}`, match: (p) => p.startsWith('/matchup') },
  { key: 'team', label: 'Team', to: (id) => `/roster?league=${id}`, match: (p) => p.startsWith('/roster') || p.startsWith('/team-analytics') },
  { key: 'players', label: 'Players', to: (id) => `/free-agents?league=${id}`, match: (p) => p.startsWith('/free-agents') },
  { key: 'league', label: 'League', to: (id) => `/league/${id}`, match: (p) => LEAGUE_PATHS.some((x) => p.startsWith(x)) },
];

export function LeagueHeader({
  weekLabel,
  onWeekPress,
  onWeekPrev,
  onWeekNext,
  onSettingsPress,
  onLeaguePress,
  showSubTabs = true,
  leagueId: leagueIdProp,
  leagueName: leagueNameProp,
  crestSrc,
  className,
}: LeagueHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ leagueId?: string }>();

  // The league the URL names wins over the context's active league. Same rule
  // matchupUrlSync.ts argues for: the path is the source of truth, and a
  // header that disagrees with the page under it is how a manager ends up
  // reading one league's name over another league's rows.
  const leagueId = params.leagueId ?? leagueIdProp ?? null;
  const leagueName = leagueNameProp ?? '';
  const crest = crestSrc ?? null;

  const activeKey = SUB_TABS.find((t) => t.match(location.pathname))?.key ?? 'league';

  // The crest and the name, drawn once for both the button and the link.
  const identity = (
    <>
      <span className="w-[30px] h-[30px] flex-shrink-0 rounded-[7px] bg-pressbox-tile-high ring-1 ring-white/[0.08] flex items-center justify-center overflow-hidden">
        {crest ? (
          <img src={crest} alt="" className="w-[22px] h-[22px] object-contain" />
        ) : (
          <span className="font-condensed font-extrabold text-[13px] text-pressbox-text">
            {(leagueName || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="font-condensed font-bold text-[22px] uppercase tracking-[0.02em] text-pressbox-text truncate">
        {leagueName}
      </span>
    </>
  );

  return (
    <header
      className={cn(PB_TYPE, 'sticky top-0 z-app-nav bg-pressbox-surface', className)}
      style={SCANLINE}
    >
      {/* Row 1 — identity */}
      <div
        className="flex items-center gap-2.5 px-3 border-b border-white/[0.08]"
        style={{ height: HEADER_ROW1_H }}
      >
        {onLeaguePress ? (
          <button
            type="button"
            onClick={onLeaguePress}
            className="focus-citrus flex items-center gap-2.5 min-w-0 flex-1 min-h-[44px] text-left"
            aria-label={leagueName ? `Switch league, currently ${leagueName}` : 'Switch league'}
            aria-haspopup="dialog"
            data-testid="league-switcher-trigger"
          >
            {identity}
            <ChevronDown className="w-[14px] h-[14px] flex-none -ml-1 text-pressbox-text/45" strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : (
          <Link
            to={leagueId ? `/league/${leagueId}` : '/'}
            className="focus-citrus flex items-center gap-2.5 min-w-0 flex-1"
            aria-label={leagueName ? `${leagueName} home` : 'League home'}
          >
            {identity}
          </Link>
        )}

        {weekLabel && (
          <span className="flex items-center whitespace-nowrap">
            {onWeekPrev !== undefined && (
              <button
                type="button"
                onClick={onWeekPrev ?? undefined}
                disabled={!onWeekPrev}
                aria-label="Previous week"
                className="focus-citrus relative px-1 font-plex text-[12px] text-pressbox-text/45 disabled:opacity-30 after:absolute after:-inset-y-[13px] after:-inset-x-2 after:content-['']"
              >
                &lsaquo;
              </button>
            )}
            <button
              type="button"
              onClick={onWeekPress}
              disabled={!onWeekPress}
              className="focus-citrus font-plex font-medium text-[10px] text-pressbox-text/45 whitespace-nowrap disabled:cursor-default"
              aria-label={onWeekPress ? `Change week, currently ${weekLabel}` : weekLabel}
            >
              {weekLabel}
            </button>
            {onWeekNext !== undefined && (
              <button
                type="button"
                onClick={onWeekNext ?? undefined}
                disabled={!onWeekNext}
                aria-label="Next week"
                className="focus-citrus relative px-1 font-plex text-[12px] text-pressbox-text/45 disabled:opacity-30 after:absolute after:-inset-y-[13px] after:-inset-x-2 after:content-['']"
              >
                &rsaquo;
              </button>
            )}
          </span>
        )}

        <button
          type="button"
          onClick={() => (onSettingsPress ? onSettingsPress() : leagueId && navigate(`/league/${leagueId}`))}
          className="focus-citrus min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-pressbox-text/55"
          aria-label="League settings"
        >
          <SlidersHorizontal className="w-[18px] h-[18px]" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Row 2 — the four-column sub-tab strip */}
      {showSubTabs && (
      <nav
        className="grid grid-cols-4 border-b border-white/[0.08]"
        style={{ height: HEADER_SUBTAB_H }}
        aria-label="League sections"
      >
        {SUB_TABS.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <Link
              key={tab.key}
              to={leagueId ? tab.to(leagueId) : '/'}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-citrus relative flex items-center justify-center font-condensed font-bold',
                'text-[13px] uppercase tracking-[0.14em]',
                active ? 'text-pressbox-text' : 'text-pressbox-text/45',
              )}
            >
              {tab.label}
              {/* 200ms underline slide, per the Interactions table. */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute bottom-0 left-0 right-0 h-[2px] bg-pressbox-sage origin-center',
                  'transition-transform duration-200 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none',
                  active ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </Link>
          );
        })}
      </nav>
      )}
    </header>
  );
}

export default LeagueHeader;
