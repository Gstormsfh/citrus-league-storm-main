import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getTodayMST } from '@/utils/timezoneUtils';
import { TeamDisc } from './TeamDisc';
import {
  avatarOf,
  formatScore,
  isBye,
  isFinal,
  leaderOf,
  ownSideOf,
  scoreboardState,
  teamNameOf,
  type ScoreboardSide,
  type TeamAvatarMap,
  type WeekMatchupRow,
} from './scoreboard';

/**
 * LEAGUE SCOREBOARD STRIP (2026-09-01, Sleeper parity audit M7)
 *
 * The league's other matchups used to live only in a "View Matchup" <Select>
 * — a form control for what is, on every other fantasy app, a scoreboard.
 * This is Citrus's scoreboard rail: one chip per matchup, both teams stacked
 * the way a broadcast ticker stacks them (disc · name · score), so a manager
 * scans the whole league in one thumb-flick and hops into any matchup with a
 * tap. The tap is client-side: the page swaps the viewed matchup in place and
 * the strip stays put (matchupLoadEfficiencyGuard — no reloads).
 *
 * Two layouts, one chip:
 *   strip — horizontal, full-bleed, scroll-snap, edge fades that appear only
 *           when there is more to scroll (a hidden scrollbar with no fade is
 *           how two ArmchairGM tools went invisible in 2026-08). Phones.
 *   rail  — vertical list in the desktop left aside, beside MatchupSidebar.
 *
 * Colour follows the identity ≠ standing rule ScoreCard.test.tsx locks:
 *   pastel-orange  = YOU   (ring on your chip; your name and disc inside it)
 *   pastel-sage    = AHEAD (the leading score in every chip; the LIVE dot)
 * The opponent and every stranger stay cream/muted. Numbers are jbmono with
 * tabular figures; words are the display face at the text-white/55 floor.
 *
 * What it does NOT show: projected scores for other matchups. The league
 * endpoint (api/matchups.getLeagueMatchups) serves banked team1_score /
 * team2_score only — see scoreboard.ts. Live scores only, honestly labelled.
 */

export interface ScoreboardStripProps {
  /** Every matchup in the viewed week, as Matchup.tsx holds `allWeekMatchups`. */
  matchups: WeekMatchupRow[];
  /** The viewer's own matchup — its chip carries the orange identity ring. */
  ownMatchupId?: string | null;
  /** The viewer's own team — that name and disc go orange inside the chip. */
  ownTeamId?: string | null;
  /** The matchup currently on screen — its chip sits in the raised state. */
  viewedMatchupId?: string | null;
  /** Tap → switch the viewed matchup. Not called for the chip already on screen. */
  onSelect: (matchupId: string) => void;
  /** Week number for the eyebrow ("Scoreboard · Wk 5"). */
  week?: number;
  /** True while any NHL game the page knows about is in progress (scoreboard.anyGameLive). */
  live?: boolean;
  /**
   * Team id → owner's profile picture (league/teams response, audit M8).
   * The matchups join serves no picture; without this map every disc is an
   * initial, which is still a complete strip.
   */
  teamAvatars?: TeamAvatarMap;
  layout?: 'strip' | 'rail';
  /** YYYY-MM-DD in Mountain Time; defaults to today. Injectable for tests. */
  today?: string;
  className?: string;
}

const EYEBROW = 'font-jbmono text-[10px] font-bold uppercase tracking-[0.22em] leading-none';
/** Matches `scroll-pl-3` / `px-3` on the scroller (Tailwind spacing 3 = 12px). */
const SCROLL_PADDING_PX = 12;

const StateTag = ({ state }: { state: 'final' | 'live' | 'open' }) => {
  if (state === 'live') {
    return (
      <span data-testid="scoreboard-state" data-state="live" className={cn(EYEBROW, 'inline-flex items-center gap-1 text-pastel-sage')}>
        <span className="w-1.5 h-1.5 rounded-full bg-pastel-sage animate-pulse" aria-hidden="true" />
        Live
      </span>
    );
  }
  if (state === 'final') {
    return (
      <span data-testid="scoreboard-state" data-state="final" className={cn(EYEBROW, 'text-white/55')}>
        Final
      </span>
    );
  }
  return null;
};

interface TeamLineProps {
  row: WeekMatchupRow;
  side: ScoreboardSide;
  own: boolean;
  leading: boolean;
  teamAvatars?: TeamAvatarMap;
}

const TeamLine = ({ row, side, own, leading, teamAvatars }: TeamLineProps) => {
  const name = teamNameOf(row, side);
  const score = side === 'team1' ? row.team1_score : row.team2_score;
  return (
    <span className="flex items-center gap-1.5 min-w-0" data-testid={`scoreboard-${side}`} data-own={own || undefined}>
      {/* The same disc the sticky bar and ScoreCard draw (TeamDisc):
          owner avatar → team initial. */}
      <TeamDisc size="xs" name={name} avatarUrl={avatarOf(row, side, teamAvatars)} own={own} />
      <span
        className={cn(
          'flex-1 min-w-0 truncate font-display text-[11px] leading-4',
          own ? 'text-pastel-orange-soft font-semibold' : 'text-pastel-cream',
        )}
        title={name}
      >
        {name}
      </span>
      <span
        data-testid="scoreboard-score"
        data-leading={leading || undefined}
        className={cn(
          'font-jbmono text-[12px] font-bold tabular-nums leading-4 flex-shrink-0',
          leading ? 'text-pastel-sage' : 'text-white/70',
        )}
      >
        {formatScore(score)}
      </span>
    </span>
  );
};

const ByeLine = () => (
  <span className="flex items-center gap-1.5 min-w-0" data-testid="scoreboard-team2" data-bye="true">
    <span className="w-5 h-5 rounded-full flex-shrink-0 border border-dashed border-white/15" aria-hidden="true" />
    <span className="flex-1 min-w-0 truncate font-display text-[11px] leading-4 text-white/55">Bye week</span>
  </span>
);

interface ChipProps {
  row: WeekMatchupRow;
  layout: 'strip' | 'rail';
  own: boolean;
  ownSide: ScoreboardSide | null;
  viewed: boolean;
  final: boolean;
  onSelect: (id: string) => void;
  teamAvatars?: TeamAvatarMap;
}

const Chip = ({ row, layout, own, ownSide, viewed, final, onSelect, teamAvatars }: ChipProps) => {
  const bye = isBye(row);
  const leader = leaderOf(row);
  const t1 = teamNameOf(row, 'team1');
  const t2 = bye ? 'bye week' : teamNameOf(row, 'team2');
  const label = bye
    ? `${t1} ${formatScore(row.team1_score)}, ${t2}`
    : `${t1} ${formatScore(row.team1_score)}, ${t2} ${formatScore(row.team2_score)}`;
  const suffix = [own ? 'your matchup' : null, viewed ? 'viewing' : null, final ? 'final' : null]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      data-testid="scoreboard-chip"
      data-matchup-id={row.id}
      data-own={own || undefined}
      data-viewed={viewed || undefined}
      data-final={final || undefined}
      aria-current={viewed ? 'true' : undefined}
      aria-label={suffix ? `${label} — ${suffix}` : label}
      onClick={() => {
        if (!viewed) onSelect(row.id);
      }}
      className={cn(
        'focus-citrus block text-left rounded-xl px-2 py-1.5 space-y-1 transition-colors active:scale-[0.98]',
        layout === 'strip' ? 'w-[150px]' : 'w-full',
        // Raised = on screen now. Dark-UI depth is lightness, not shadow.
        viewed ? 'bg-pastel-surface-high' : 'bg-pastel-surface-tile hover:bg-pastel-surface-high',
        // Identity ring (WHO), never the sage that means AHEAD.
        own ? 'ring-2 ring-pastel-orange/60' : viewed ? 'ring-1 ring-white/20' : 'ring-1 ring-white/10',
      )}
    >
      <TeamLine row={row} side="team1" own={ownSide === 'team1'} leading={leader === 'team1'} teamAvatars={teamAvatars} />
      {bye ? (
        <ByeLine />
      ) : (
        <TeamLine row={row} side="team2" own={ownSide === 'team2'} leading={leader === 'team2'} teamAvatars={teamAvatars} />
      )}
    </button>
  );
};

export function ScoreboardStrip({
  matchups,
  ownMatchupId,
  ownTeamId,
  viewedMatchupId,
  onSelect,
  week,
  live = false,
  teamAvatars,
  layout = 'strip',
  today,
  className,
}: ScoreboardStripProps) {
  const todayStr = today ?? getTodayMST();
  const state = scoreboardState(matchups, todayStr, live);
  // Which matchups are on the strip — changes with the week, not with the
  // 120s score refresh (same ids, fresh numbers), so a refresh never moves
  // the strip under the reader.
  const listKey = matchups.map((m) => m.id).join('|');
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const scrolledOnceRef = useRef(false);
  // The chip the user just tapped is already under their thumb; the scroll
  // effect below must not slide it away when it becomes the viewed one.
  const tappedRef = useRef<string | null>(null);

  const handleSelect = useCallback(
    (id: string) => {
      tappedRef.current = id;
      onSelect(id);
    },
    [onSelect],
  );

  // Edge fades only while there is something past that edge to reach.
  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { left: el.scrollLeft > 4, right: max - el.scrollLeft > 4 };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  useEffect(() => {
    if (layout !== 'strip') return;
    measure();
    if (typeof ResizeObserver === 'undefined' || !listRef.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [layout, measure, listKey]);

  // Bring the chip that matters to the front: the one on screen, else yours —
  // on first paint, when those ids arrive, and when a new week's list lands.
  // Not after a tap (the chip is already in view). It lands on the snap
  // position for that chip (its start, behind the 12px scroll padding), so
  // the snap engine agrees with it instead of nudging it. Instant the first
  // time, smooth after; horizontal scroll on the list only — never
  // scrollIntoView, which would also move the page vertically.
  useEffect(() => {
    if (layout !== 'strip') return;
    const list = listRef.current;
    const targetId = viewedMatchupId || ownMatchupId;
    if (!list || !targetId) return;
    if (tappedRef.current === targetId) {
      tappedRef.current = null;
      return;
    }
    const item = Array.from(list.children).find(
      (c) => (c as HTMLElement).dataset.matchupId === targetId,
    ) as HTMLElement | undefined;
    if (!item) return;
    const left = Math.max(0, item.offsetLeft - SCROLL_PADDING_PX);
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = scrolledOnceRef.current && !reduce ? 'smooth' : 'auto';
    scrolledOnceRef.current = true;
    if (typeof list.scrollTo === 'function') list.scrollTo({ left, behavior });
    else list.scrollLeft = left;
    measure();
  }, [layout, viewedMatchupId, ownMatchupId, listKey, measure]);

  if (matchups.length === 0) return null;

  const header = (
    <div className={cn('flex items-center justify-between gap-2', layout === 'strip' ? 'px-3 mb-1.5' : 'mb-2')}>
      <span className={cn(EYEBROW, 'text-pastel-sage')}>
        Scoreboard
        {typeof week === 'number' && week > 0 && (
          <span className="text-white/55"> · Wk {week}</span>
        )}
      </span>
      <StateTag state={state} />
    </div>
  );

  const items = matchups.map((row) => (
    <li
      key={row.id}
      data-matchup-id={row.id}
      className={cn(layout === 'strip' && 'snap-start shrink-0')}
    >
      <Chip
        row={row}
        layout={layout}
        own={row.id === ownMatchupId}
        ownSide={ownSideOf(row, ownTeamId)}
        viewed={row.id === viewedMatchupId}
        final={isFinal(row, todayStr)}
        onSelect={handleSelect}
        teamAvatars={teamAvatars}
      />
    </li>
  ));

  if (layout === 'rail') {
    return (
      <section
        data-testid="scoreboard-strip"
        data-layout="rail"
        data-state={state}
        aria-label="League scoreboard"
        className={cn('rounded-2xl bg-pastel-surface-tile ring-1 ring-white/10 p-3', className)}
      >
        {header}
        <ul className="flex flex-col gap-1.5">{items}</ul>
      </section>
    );
  }

  return (
    <section
      data-testid="scoreboard-strip"
      data-layout="strip"
      data-state={state}
      aria-label="League scoreboard"
      className={cn('w-full', className)}
    >
      {header}
      <div className="relative">
        {/* The strip scrolls inside its own box. Nothing here touches the
            document's overflow (stickyScrollContainerGuard). */}
        <ul
          ref={listRef}
          onScroll={measure}
          data-testid="scoreboard-scroller"
          className="flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-pl-3 px-3 pb-1 overscroll-x-contain"
        >
          {items}
        </ul>
        <div
          aria-hidden="true"
          data-testid="scoreboard-fade-left"
          hidden={!edges.left}
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-pastel-surface to-transparent"
        />
        <div
          aria-hidden="true"
          data-testid="scoreboard-fade-right"
          hidden={!edges.right}
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-pastel-surface to-transparent"
        />
      </div>
    </section>
  );
}

export default ScoreboardStrip;
