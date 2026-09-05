/**
 * THE PLAYERS SCREEN ON A PHONE — artboard 1a, fifth phone.
 *
 * Everything under the league header: the six-verb action tile, a section
 * head with its toggle, the position chips, a column head, the rows. The
 * PAGE owns the data and the handlers (it has for two years, across 2,700
 * lines); this owns the layout and nothing else, which is why every list
 * arrives as `rows` plus a `renderRow`, and every control as a value plus a
 * setter. It can be rendered by the harness with fixtures and by the page
 * with the real pool, and it is the same component both times.
 *
 * WHAT THE ARTBOARD DRAWS, VALUE BY VALUE
 *   * Action tile — `PressBoxActionGrid`, the six words in the order drawn.
 *   * `TRENDING · 24H` + `▲ ADDS ▼ DROPS`: Barlow Condensed 700 15px head
 *     with the count at 45%, and a sage-active `sm` segmented control
 *     sharing its line, `margin-top:14px`.
 *   * Chips `ALL C LW RW D G`, `margin-top:10px`, `5px 10px`, hairline on
 *     the inactive ones.
 *   * Column head: Plex 500 9px at 40%, `.06em`, grid `22px 1fr 60px 40px`
 *     gap 8, `padding:12px 2px 4px`.
 *   * Rows: `PressBoxPlayerRow`, 64px.
 *
 * WHAT IS NOT DRAWN, AND WHY
 *   * `FA ONLY`. Every player this page holds is already a free agent — the
 *     pool it fetches is the league's unrostered set — so a chip that could
 *     only ever be ON would be a control with no effect. It returns the day
 *     the page can list rostered players too.
 *   * `ROS%` in the column head. There is no league-wide ownership read in
 *     the app yet (PR12); the row prints none, so the head names none. A
 *     header for a column that is not there is the kind of small lie a
 *     manager stops trusting the screen over.
 *
 * THREE VIEWS, ONE LIST. TREND is the artboard's; AVAILABLE is the full pool
 * ordered by the week's projection (or, under GAMES, by how many games are
 * left this week — the page's schedule maximizer); WATCH is the starred set.
 * LEADERS and TRADE are other screens and the tile links to them.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUpDown, BarChart3, Search, Star, TrendingUp, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxActionGrid } from '@/components/pressbox/ActionGrid';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxSegmented } from '@/components/pressbox/Segmented';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PressBoxSkeletonRows } from '@/components/pressbox/Skeleton';

export type PlayersPhoneView = 'trend' | 'available' | 'watch';
export type PlayersTrendMode = 'adds' | 'drops';
export type PlayersAvailableMode = 'proj' | 'games';

export interface PlayersPhoneProps<P> {
  view: PlayersPhoneView;
  onView: (view: PlayersPhoneView) => void;
  /** Routes for the two cells that leave the screen. */
  leadersTo: string;
  tradeTo: string;

  trendMode: PlayersTrendMode;
  onTrendMode: (mode: PlayersTrendMode) => void;
  availableMode: PlayersAvailableMode;
  onAvailableMode: (mode: PlayersAvailableMode) => void;

  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
  searchQuery: string;
  onSearchQuery: (q: string) => void;

  /** `['ALL','C','LW','RW','W','D','G']` — the page's own list for the league's format. */
  positions: readonly string[];
  positionFilter: string;
  onPosition: (pos: string) => void;

  /** Full count of the list behind `rows` (for the head and `+ N MORE`). */
  total: number;
  rows: readonly P[];
  /** Returns a keyed element — the list maps over it directly. */
  renderRow: (row: P, index: number) => ReactNode;
  /** Present when more rows exist than `rows` holds. */
  onMore?: () => void;

  loading?: boolean;
  /**
   * Rendered in place of the list while `loading`. Absent, the list's own
   * skeleton: the column head and eight rows with the words missing (PR3).
   */
  loadingSlot?: ReactNode;
  /** Above the list: a warning, a demo-mode call to action. */
  banner?: ReactNode;
  /** Empty-state copy for the current view. */
  empty: { title: string; body: string; action?: { label: string; onSelect: () => void } };
  /** The watch list's size, for the WATCH cell's accessible name. */
  watchCount?: number;
  className?: string;
}

const VIEW_LABEL: Record<PlayersPhoneView, string> = {
  trend: 'Trending',
  available: 'Available',
  watch: 'Watch list',
};

export function PlayersPhone<P>({
  view,
  onView,
  leadersTo,
  tradeTo,
  trendMode,
  onTrendMode,
  availableMode,
  onAvailableMode,
  searchOpen,
  onSearchOpen,
  searchQuery,
  onSearchQuery,
  positions,
  positionFilter,
  onPosition,
  total,
  rows,
  renderRow,
  onMore,
  loading = false,
  loadingSlot,
  banner,
  empty,
  watchCount = 0,
  className,
}: PlayersPhoneProps<P>) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const movementHead =
    view === 'trend'
      ? trendMode === 'adds'
        ? '24H adds'
        : '24H drops'
      : availableMode === 'games' && view === 'available'
        ? 'Games'
        : 'WK proj';

  const headCount =
    view === 'trend' ? '24H' : total > 0 ? String(total) : null;

  return (
    <div className={cn(PB_TYPE, 'px-3.5 pt-3', className)} data-testid="players-phone">
      <PressBoxActionGrid
        label="Players actions"
        cells={[
          {
            key: 'search',
            label: 'Search',
            icon: Search,
            active: searchOpen,
            onSelect: () => onSearchOpen(!searchOpen),
            ariaLabel: searchOpen ? 'Close search' : 'Search players',
          },
          { key: 'trend', label: 'Trend', icon: TrendingUp, active: view === 'trend', onSelect: () => onView('trend') },
          {
            key: 'available',
            label: 'Available',
            icon: UserPlus,
            active: view === 'available',
            onSelect: () => onView('available'),
          },
          { key: 'leaders', label: 'Leaders', icon: BarChart3, to: leadersTo },
          { key: 'trade', label: 'Trade', icon: ArrowUpDown, to: tradeTo },
          {
            key: 'watch',
            label: 'Watch',
            icon: Star,
            active: view === 'watch',
            onSelect: () => onView('watch'),
            ariaLabel: watchCount > 0 ? `Watch list, ${watchCount}` : 'Watch list',
          },
        ]}
      />

      {searchOpen && (
        <div className="mt-2.5 flex items-center gap-2 h-[38px] px-3 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
          <Search className="w-[15px] h-[15px] text-pressbox-text/45" strokeWidth={2} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            placeholder="Search players…"
            aria-label="Search players"
            data-testid="players-phone-search"
            className="flex-1 min-w-0 bg-transparent font-barlow text-[14px] text-pressbox-text placeholder:text-pressbox-text/45 outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQuery('')}
              className="focus-citrus font-plex font-semibold text-[9px] tracking-[0.08em] text-pressbox-text/55 uppercase"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <PressBoxSectionHead
        className="mt-3.5"
        title={searchQuery ? 'Results' : VIEW_LABEL[view]}
        count={searchQuery ? (total > 0 ? String(total) : null) : headCount}
        action={
          !searchQuery && view === 'trend' ? (
            <PressBoxSegmented
              size="sm"
              tone="sage"
              label="Trending direction"
              activeKey={trendMode}
              onSelect={(k) => onTrendMode(k as PlayersTrendMode)}
              segments={[
                { key: 'adds', label: '▲ ADDS' },
                { key: 'drops', label: '▼ DROPS' },
              ]}
            />
          ) : !searchQuery && view === 'available' ? (
            <PressBoxSegmented
              size="sm"
              label="Available order"
              activeKey={availableMode}
              onSelect={(k) => onAvailableMode(k as PlayersAvailableMode)}
              segments={[
                { key: 'proj', label: 'PROJ' },
                { key: 'games', label: 'GAMES' },
              ]}
            />
          ) : undefined
        }
      />

      <PressBoxChips
        className="mt-2.5 overflow-x-auto scrollbar-hide"
        label="Position filter"
        outlined
        compact
        activeKey={positionFilter}
        onSelect={onPosition}
        chips={positions.map((p) => ({ key: p, label: p === 'W' ? 'WING' : p }))}
      />

      {banner && <div className="mt-3">{banner}</div>}

      {loading ? (
        loadingSlot ? (
          <div className="mt-3">{loadingSlot}</div>
        ) : (
          <div data-testid="players-phone-loading">
            <div
              className="grid grid-cols-[22px_1fr_60px_40px] gap-2 pt-3 pb-1 px-0.5 font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40"
              aria-hidden="true"
            >
              <span>#</span>
              <span>Player · WK proj</span>
              <span className="text-right">{movementHead}</span>
              <span />
            </div>
            <PressBoxSkeletonRows rows={8} rank action />
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="py-10 text-center" data-testid="players-phone-empty">
          <div className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">
            {empty.title}
          </div>
          <div className="mt-1 font-plex font-medium text-[10px] text-pressbox-text/45">{empty.body}</div>
          {empty.action && (
            <button
              type="button"
              onClick={empty.action.onSelect}
              className="focus-citrus mt-4 px-[11px] py-[5px] rounded-full bg-pressbox-text text-pressbox-surface font-plex font-semibold text-[10px] tracking-[0.06em] uppercase"
            >
              {empty.action.label}
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-[22px_1fr_60px_40px] gap-2 pt-3 pb-1 px-0.5 font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40"
            aria-hidden="true"
          >
            <span>#</span>
            <span>Player · WK proj</span>
            <span className="text-right">{movementHead}</span>
            <span />
          </div>
          {/* Inside the gutter, as drawn — the column head's `padding:12px 2px
              4px` and the rows share the same 366px. `renderRow` keys its
              element. */}
          <div className="border-b border-white/[0.06]" data-testid="players-phone-list">
            {rows.map((row, i) => renderRow(row, i))}
          </div>
          {onMore && total > rows.length && (
            <button
              type="button"
              onClick={onMore}
              className="focus-citrus w-full py-3 font-plex font-semibold text-[10px] tracking-[0.08em] uppercase text-pressbox-orange-soft"
            >
              + {total - rows.length} more
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default PlayersPhone;
