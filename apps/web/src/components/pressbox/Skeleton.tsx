/**
 * PRESS BOX SKELETONS (PR3, motion board 2b, 2026-09-04).
 *
 * "The skeleton mirrors the final layout exactly -- same grid, same row
 * heights -- so nothing jumps. Position chips render in their real colour
 * at 50% opacity; text blocks shimmer; 100-150ms stagger per row."
 *
 * Until now the phone loaded behind the full-screen Stormy loader ("Loading
 * your roster...") or a column of pulsing tiles. A loader that looks nothing
 * like the screen makes the screen arrive as a swap; a skeleton that IS the
 * screen with the words missing makes it settle. Every piece here is the
 * height of the row it stands in for: the player row is 64, the roster
 * starter 56 and bench 52, the standings row 56, the section head 15/22.
 *
 * Presentational, no context, so the barrel stays importable in tests.
 * `pb-shimmer` lives in index.css (the tile-coloured gradient the board
 * specifies) and is switched off under prefers-reduced-motion there.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';
import { PB_CHIP_BENCH, PB_CHIP_STARTER, PB_POSITION_CHIP_BASE, pressBoxPositionChipClasses } from './positionChip';

/** Rows enter 120ms apart (the board's 100-150). */
const STAGGER_MS = 120;
const stagger = (i: number) => ({ animationDelay: `${i * STAGGER_MS}ms` });

/**
 * One shimmering bar. Width and height are the caller's. `tone="tile"` is
 * the bar that sits ON a tile -- one step up the surface scale, because a
 * tile-coloured bar on a tile is invisible.
 */
export function PressBoxSkeletonBar({
  className,
  style,
  tone = 'surface',
}: {
  className?: string;
  style?: React.CSSProperties;
  tone?: 'surface' | 'tile';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded-[4px]', tone === 'tile' ? 'pb-shimmer-high' : 'pb-shimmer', className)}
      style={style}
    />
  );
}

export interface PressBoxSkeletonRowProps {
  /** `C`, `LW`, `G` -- drawn as the real chip at half strength. */
  chip?: string | null;
  /** `tile` when the row sits inside a tile (see `PressBoxSkeletonBar`). */
  tone?: 'surface' | 'tile';
  /** 64 is the player row; 56 a starter; 52 a bench row. */
  height?: 64 | 56 | 52;
  /** Draws the 22px rank slot the Players rows carry. */
  rank?: boolean;
  /** Draws the 40px face. */
  mug?: boolean;
  /** The figure column on the right. */
  figure?: boolean;
  /** The 40px action square after the figure (the Players rows' ADD). */
  action?: boolean;
  index?: number;
  last?: boolean;
  className?: string;
}

/** The player / roster row with the words missing. */
export function PressBoxSkeletonRow({
  chip,
  height = 64,
  rank = false,
  mug = true,
  figure = true,
  action = false,
  index = 0,
  last = false,
  className,
  tone = 'surface',
}: PressBoxSkeletonRowProps) {
  const sweep = tone === 'tile' ? 'pb-shimmer-high' : 'pb-shimmer';
  return (
    <div
      role="status"
      aria-label="Loading"
      data-testid="pb-skeleton-row"
      className={cn(
        PB_TYPE,
        'flex items-center gap-2',
        height === 64 ? 'min-h-[64px]' : height === 56 ? 'min-h-[56px]' : 'min-h-[52px]',
        !last && 'border-b border-white/[0.06]',
        className,
      )}
      style={stagger(index)}
    >
      {rank && <PressBoxSkeletonBar tone={tone} className="w-[14px] h-[11px] mx-1 flex-none" style={stagger(index)} />}
      {chip && (
        <span aria-hidden="true" className={cn(pressBoxPositionChipClasses(chip), 'opacity-50 flex-none')}>
          {chip}
        </span>
      )}
      {mug && (
        <span className={cn('w-10 h-10 flex-none rounded-full border-[1.5px] border-white/[0.08]', sweep)} style={stagger(index)} />
      )}
      <span className="flex-1 min-w-0 flex flex-col gap-1.5">
        <PressBoxSkeletonBar tone={tone} className="h-[14px] w-[46%]" style={stagger(index)} />
        <PressBoxSkeletonBar tone={tone} className="h-[10px] w-[28%]" style={stagger(index)} />
      </span>
      {figure && <PressBoxSkeletonBar tone={tone} className="w-[40px] h-[15px] flex-none" style={stagger(index)} />}
      {action && <span className={cn('w-10 h-10 flex-none rounded-[10px] border border-white/[0.08]', sweep)} style={stagger(index)} />}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** A section head's bar: condensed 15px is 22px tall. */
export function PressBoxSkeletonHead({ width = 120, className }: { width?: number; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between h-[22px]', className)}>
      <PressBoxSkeletonBar className="h-[15px]" style={{ width }} />
      <PressBoxSkeletonBar className="h-[10px] w-[48px]" />
    </div>
  );
}

/** A tile with rows inside, the way the lists are drawn. */
export function PressBoxSkeletonList({
  rows,
  chips,
  height = 64,
  rank,
  mug = true,
  className,
  startIndex = 0,
}: {
  rows: number;
  chips?: (string | null)[];
  height?: 64 | 56 | 52;
  rank?: boolean;
  mug?: boolean;
  className?: string;
  startIndex?: number;
}) {
  return (
    <div className={cn('rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-2.5', className)} data-testid="pb-skeleton-list">
      {Array.from({ length: rows }).map((_, i) => (
        <PressBoxSkeletonRow key={i} chip={chips?.[i] ?? null} height={height} rank={rank} mug={mug} index={startIndex + i} last={i === rows - 1} tone="tile" />
      ))}
    </div>
  );
}

/**
 * Bare rows under a hairline each, no tile -- the way the Players, Waivers
 * and Trades lists are drawn (`border-t` per row, `border-b` on the list).
 */
export function PressBoxSkeletonRows({
  rows,
  chips,
  height = 64,
  rank,
  mug = true,
  action,
  className,
  startIndex = 0,
}: {
  rows: number;
  chips?: (string | null)[];
  height?: 64 | 56 | 52;
  rank?: boolean;
  mug?: boolean;
  action?: boolean;
  className?: string;
  startIndex?: number;
}) {
  return (
    <div className={cn('border-b border-white/[0.06]', className)} data-testid="pb-skeleton-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <PressBoxSkeletonRow
          key={i}
          chip={chips?.[i] ?? null}
          height={height}
          rank={rank}
          mug={mug}
          action={action}
          index={startIndex + i}
          last
          className="border-t border-white/[0.06]"
        />
      ))}
    </div>
  );
}

/** The four-up stat tiles (player card, account). */
export function PressBoxSkeletonTiles({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-4 gap-1.5', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-2 rounded-[10px] bg-pressbox-tile border border-white/[0.08]" style={stagger(i)}>
          <PressBoxSkeletonBar tone="tile" className="h-[8px] w-[60%]" style={stagger(i)} />
          <PressBoxSkeletonBar tone="tile" className="mt-2 h-[17px] w-[50%]" style={stagger(i)} />
        </div>
      ))}
    </div>
  );
}

/**
 * A card-sized block: the team card, the score block, a lead tile. `lines`
 * is how many bars fit the height honestly -- one for a 52px row, two for
 * an 84px story row, three for a 92px game tile or anything taller.
 */
export function PressBoxSkeletonCard({
  height = 92,
  lines,
  className,
  index = 0,
}: {
  height?: number;
  lines?: 1 | 2 | 3;
  className?: string;
  index?: number;
}) {
  const n = lines ?? (height < 64 ? 1 : height < 90 ? 2 : 3);
  return (
    <div
      className={cn('rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3.5 py-3 flex flex-col justify-center gap-2', className)}
      style={{ minHeight: height, ...stagger(index) }}
      data-testid="pb-skeleton-card"
    >
      {n >= 2 && <PressBoxSkeletonBar tone="tile" className="h-[9px] w-[30%]" style={stagger(index)} />}
      <PressBoxSkeletonBar tone="tile" className="h-[22px] w-[55%]" style={stagger(index)} />
      {n >= 3 && <PressBoxSkeletonBar tone="tile" className="h-[10px] w-[40%]" style={stagger(index)} />}
    </div>
  );
}

/**
 * THE ROSTER WITH THE WORDS MISSING. Mirrors `PressBoxRosterList` piece for
 * piece -- the same full-bleed surface, the same `30px_30px_1fr_52px` grid,
 * a 56px starter and a 52px bench row, the STARTERS and BENCH heads at
 * their real height -- so the list arrives in place rather than on top of
 * a loader. The slot chips are the real starter chips at half strength.
 * The page draws the team card, the segmented control and the day strip
 * above this, exactly as it does above the real list.
 */
const ROSTER_STARTERS = ['C', 'C', 'LW', 'LW', 'RW', 'RW', 'D', 'D', 'D', 'D', 'G', 'G'];
const ROSTER_BENCH = 4;
const ROSTER_GRID = 'grid items-center gap-2 border-t border-white/[0.06] grid-cols-[30px_30px_1fr_52px]';

function SkeletonRosterRow({ slot, bench, index }: { slot: string; bench: boolean; index: number }) {
  return (
    <div
      data-testid="pb-skeleton-roster-row"
      className={cn(ROSTER_GRID, bench ? 'min-h-[52px]' : 'min-h-[56px]')}
      style={stagger(index)}
    >
      <span
        aria-hidden="true"
        className={cn(PB_POSITION_CHIP_BASE, bench ? PB_CHIP_BENCH : PB_CHIP_STARTER, 'opacity-50')}
      >
        <span>{slot}</span>
        {!bench && (
          <span className="text-[8px] leading-none opacity-70">⇄</span>
        )}
      </span>
      <span className="w-[30px] h-[30px] box-border rounded-full pb-shimmer border-[1.5px] border-white/[0.16]" style={stagger(index)} />
      <span className="min-w-0 flex flex-col gap-1.5">
        <PressBoxSkeletonBar className="h-[14px] w-[52%]" style={stagger(index)} />
        <PressBoxSkeletonBar className="h-[10px] w-[30%]" style={stagger(index)} />
      </span>
      <span className="flex flex-col items-end gap-1">
        <PressBoxSkeletonBar className="h-[15px] w-[32px]" style={stagger(index)} />
        <PressBoxSkeletonBar className="h-[8px] w-[22px]" style={stagger(index)} />
      </span>
    </div>
  );
}

const ROSTER_SECTION = 'font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text';
const ROSTER_COLHEAD = 'font-plex font-medium text-[9px] uppercase tracking-[0.06em] text-pressbox-text/40';

export function PressBoxSkeletonRoster({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading your roster"
      data-testid="pb-skeleton-roster"
      className={cn(PB_TYPE, 'bg-pressbox-surface border-t border-white/[0.08] px-3 pt-2.5', className)}
    >
      <div className="flex items-center justify-between mt-3 px-0.5">
        <h2 className={ROSTER_SECTION}>
          Starters <span className="text-pressbox-text/45">· –/{ROSTER_STARTERS.length}</span>
        </h2>
      </div>
      <div aria-hidden="true" className={cn('grid gap-2 pt-2 pb-1 px-0.5 grid-cols-[30px_30px_1fr_52px]', ROSTER_COLHEAD)}>
        <span />
        <span />
        <span>Player</span>
        <span className="text-right">Today</span>
      </div>
      <div>
        {ROSTER_STARTERS.map((slot, i) => (
          <SkeletonRosterRow key={i} slot={slot} bench={false} index={i} />
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 py-2 px-0.5 border-t border-white/[0.08]">
        <h2 className={ROSTER_SECTION}>
          Bench <span className="text-pressbox-text/45">· {ROSTER_BENCH}</span>
        </h2>
      </div>
      <div>
        {Array.from({ length: ROSTER_BENCH }).map((_, i) => (
          <SkeletonRosterRow key={i} slot="BN" bench index={ROSTER_STARTERS.length + i} />
        ))}
      </div>
      <span className="sr-only">Loading your roster…</span>
    </div>
  );
}

/** `PressBoxStandingsTable` with the words missing: its grid, its column head, the 26px disc. */
const STANDINGS_GRID = 'grid grid-cols-[16px_1fr_34px_42px_42px_26px_44px] gap-1 px-2.5 py-2';

export function PressBoxSkeletonStandings({ rows = 10, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('rounded-[12px] bg-pressbox-tile border border-white/[0.08] overflow-hidden', className)} data-testid="pb-skeleton-standings-table">
      <div
        aria-hidden="true"
        className={cn(STANDINGS_GRID, 'font-plex font-semibold text-[8px] tracking-[0.06em] text-pressbox-text/45 border-b border-white/[0.08]')}
      >
        <span>#</span>
        <span>TEAM</span>
        <span>W–L</span>
        <span className="text-right">PF</span>
        <span className="text-right">PA</span>
        <span className="text-center">STK</span>
        <span className="text-right">LAST 5</span>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn(STANDINGS_GRID, 'items-center min-h-[44px] border-b border-white/[0.05]')} style={stagger(i)}>
          <PressBoxSkeletonBar tone="tile" className="h-[10px] w-[10px]" style={stagger(i)} />
          <span className="flex items-center gap-[7px] min-w-0">
            <span className="w-[26px] h-[26px] flex-none rounded-full pb-shimmer-high" style={stagger(i)} />
            <span className="flex flex-col gap-1 min-w-0 flex-1">
              <PressBoxSkeletonBar tone="tile" className="h-[11px] w-[60%]" style={stagger(i)} />
              <PressBoxSkeletonBar tone="tile" className="h-[8px] w-[45%]" style={stagger(i)} />
            </span>
          </span>
          <PressBoxSkeletonBar tone="tile" className="h-[11px] w-[22px]" style={stagger(i)} />
          <PressBoxSkeletonBar tone="tile" className="h-[11px] w-[34px] justify-self-end" style={stagger(i)} />
          <PressBoxSkeletonBar tone="tile" className="h-[11px] w-[34px] justify-self-end" style={stagger(i)} />
          <PressBoxSkeletonBar tone="tile" className="h-[11px] w-[16px] justify-self-center" style={stagger(i)} />
          <span className="flex gap-[3px] justify-end">
            {[0, 1, 2, 3, 4].map((d) => (
              <span key={d} className="w-[6px] h-[6px] rounded-[1px] pb-shimmer-high" style={stagger(i)} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export type PressBoxSkeletonKind =
  | 'roster'
  | 'standings'
  | 'matchup'
  | 'hq'
  | 'players'
  | 'browse'
  | 'bracket'
  | 'scores'
  | 'news'
  | 'home'
  | 'account'
  | 'list';

/**
 * A whole screen's body, by kind. Mounted under the real chrome, so the
 * header and the sub-tabs are already there and only the body settles.
 * `roster` is the full-bleed list and carries its own gutter; the rest sit
 * in the page column.
 */
export function PressBoxSkeletonScreen({ kind, className }: { kind: PressBoxSkeletonKind; className?: string }) {
  if (kind === 'roster') {
    return (
      <div className={cn(PB_TYPE, 'pb-app-chrome', className)} data-testid="pb-skeleton-roster-screen">
        <PressBoxSkeletonCard height={72} className="mx-3 mt-3 mb-3" />
        <PressBoxSkeletonRoster />
      </div>
    );
  }
  const body = (() => {
    switch (kind) {
      case 'standings':
        return (
          <>
            <PressBoxSkeletonHead width={140} />
            <div className="mt-2 flex items-center justify-between">
              <PressBoxSkeletonBar className="h-[10px] w-[42%]" />
              <PressBoxSkeletonBar className="h-[10px] w-[24%]" />
            </div>
            <PressBoxSkeletonStandings className="mt-3" rows={10} />
          </>
        );
      case 'matchup':
        // The Match page: other-matchup chips, the score block, the day
        // strip, LINEUPS / BENCH, then the comparison rows -- mug, name,
        // slot chip in the middle, name, mug.
        return (
          <>
            <div className="flex gap-2 overflow-hidden -mx-3.5 px-3.5 pb-3 border-b border-white/[0.06]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="h-[40px] w-[66px] flex-none rounded-full pb-shimmer border border-white/[0.08]" style={stagger(i)} />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-10 h-10 rounded-full pb-shimmer border-[1.5px] border-white/[0.16]" />
                <span className="flex flex-col gap-1.5">
                  <PressBoxSkeletonBar className="h-[14px] w-[64px]" />
                  <PressBoxSkeletonBar className="h-[10px] w-[48px]" />
                </span>
              </span>
              <PressBoxSkeletonBar className="h-[10px] w-[64px]" />
              <span className="flex items-center gap-2">
                <span className="flex flex-col items-end gap-1.5">
                  <PressBoxSkeletonBar className="h-[14px] w-[64px]" />
                  <PressBoxSkeletonBar className="h-[10px] w-[32px]" />
                </span>
                <span className="w-10 h-10 rounded-full pb-shimmer border-[1.5px] border-white/[0.16]" />
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <PressBoxSkeletonBar className="h-[44px] w-[112px]" style={stagger(1)} />
              <PressBoxSkeletonBar className="h-[44px] w-[92px]" style={stagger(1)} />
            </div>
            <div className="mt-2.5 flex justify-between">
              <PressBoxSkeletonBar className="h-[10px] w-[42%]" style={stagger(2)} />
              <PressBoxSkeletonBar className="h-[10px] w-[42%]" style={stagger(2)} />
            </div>
            <PressBoxSkeletonBar className="mt-2.5 h-[6px] w-full rounded-full" style={stagger(2)} />
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="h-[44px] rounded-[8px] bg-pressbox-tile border border-white/[0.08]" style={stagger(3 + i)} />
              ))}
            </div>
            <div className="mt-5 flex gap-4 pb-2 border-b border-white/[0.06]">
              <PressBoxSkeletonBar className="h-[14px] w-[64px]" style={stagger(4)} />
              <PressBoxSkeletonBar className="h-[14px] w-[48px]" style={stagger(4)} />
            </div>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="flex items-center gap-2 min-h-[58px] border-b border-white/[0.06] -mx-3.5 px-3" style={stagger(5 + i)}>
                <span className="w-7 h-7 flex-none rounded-full pb-shimmer border-[1.5px] border-white/[0.16]" style={stagger(5 + i)} />
                <span className="flex-1 flex flex-col gap-1.5">
                  <PressBoxSkeletonBar className="h-[13px] w-[70%]" style={stagger(5 + i)} />
                  <PressBoxSkeletonBar className="h-[8px] w-[40%]" style={stagger(5 + i)} />
                </span>
                <span className="w-[30px] h-[30px] flex-none rounded-[6px] bg-white/10 opacity-50" />
                <span className="flex-1 flex flex-col items-end gap-1.5">
                  <PressBoxSkeletonBar className="h-[13px] w-[70%]" style={stagger(5 + i)} />
                  <PressBoxSkeletonBar className="h-[8px] w-[40%]" style={stagger(5 + i)} />
                </span>
                <span className="w-7 h-7 flex-none rounded-full pb-shimmer border-[1.5px] border-white/[0.16]" style={stagger(5 + i)} />
              </div>
            ))}
          </>
        );
      case 'hq':
        // League HQ: MATCHUPS and its week link, three matchup cards (disc,
        // name over score, VS, name over score, disc), the feature tiles two
        // across, then TEAMS.
        return (
          <>
            <PressBoxSkeletonHead width={96} />
            <div className="mt-2 flex flex-col gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[58px] rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3 flex items-center gap-2.5"
                  style={stagger(1 + i)}
                >
                  <span className="w-8 h-8 flex-none rounded-full pb-shimmer-high" style={stagger(1 + i)} />
                  <span className="flex-1 flex flex-col gap-1.5">
                    <PressBoxSkeletonBar tone="tile" className="h-[13px] w-[60%]" style={stagger(1 + i)} />
                    <PressBoxSkeletonBar tone="tile" className="h-[9px] w-[30%]" style={stagger(1 + i)} />
                  </span>
                  <PressBoxSkeletonBar tone="tile" className="h-[9px] w-[16px]" style={stagger(1 + i)} />
                  <span className="flex-1 flex flex-col items-end gap-1.5">
                    <PressBoxSkeletonBar tone="tile" className="h-[13px] w-[60%]" style={stagger(1 + i)} />
                    <PressBoxSkeletonBar tone="tile" className="h-[9px] w-[30%]" style={stagger(1 + i)} />
                  </span>
                  <span className="w-8 h-8 flex-none rounded-full pb-shimmer-high" style={stagger(1 + i)} />
                </div>
              ))}
            </div>
            <PressBoxSkeletonBar className="mt-3 mx-auto h-[10px] w-[128px]" style={stagger(4)} />
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-[110px] rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-3.5 py-3 flex flex-col"
                  style={stagger(5 + i)}
                >
                  <span className="w-5 h-5 rounded-[4px] pb-shimmer-high" style={stagger(5 + i)} />
                  <PressBoxSkeletonBar tone="tile" className="mt-auto h-[15px] w-[60%]" style={stagger(5 + i)} />
                  <PressBoxSkeletonBar tone="tile" className="mt-1.5 h-[9px] w-[40%]" style={stagger(5 + i)} />
                </div>
              ))}
            </div>
            <PressBoxSkeletonHead className="mt-5" width={72} />
            <PressBoxSkeletonList className="mt-2" rows={4} height={52} mug={false} startIndex={11} />
          </>
        );
      case 'players':
        // The Players page: the action tile, TRENDING + the segmented pair,
        // the position chips, the column head, then bare rows with the rank
        // column, the mug, the name and the ADD square.
        return (
          <>
            <div className="h-[70px] rounded-[12px] bg-pressbox-tile border border-white/[0.08] grid grid-cols-6 items-center px-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="flex flex-col items-center gap-2">
                  <span className="w-5 h-5 rounded-[4px] pb-shimmer-high" style={stagger(i)} />
                  <PressBoxSkeletonBar tone="tile" className="h-[8px] w-[36px]" style={stagger(i)} />
                </span>
              ))}
            </div>
            <div className="mt-3.5 flex items-center justify-between h-[22px]">
              <PressBoxSkeletonBar className="h-[15px] w-[110px]" />
              <PressBoxSkeletonBar className="h-[22px] w-[132px] rounded-[6px]" />
            </div>
            <div className="mt-2.5 flex gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <PressBoxSkeletonBar key={i} className="h-[26px] w-[44px] rounded-full" style={stagger(i)} />
              ))}
            </div>
            <div
              className="grid grid-cols-[22px_1fr_60px_40px] gap-2 pt-3 pb-1 px-0.5 font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40"
              aria-hidden="true"
            >
              <span>#</span>
              <span>Player · WK proj</span>
              <span className="text-right">24H adds</span>
              <span />
            </div>
            <PressBoxSkeletonRows rows={8} rank action startIndex={7} />
          </>
        );
      case 'browse':
        // The Players tab: the section head with its sort picker, the
        // position chips, the column head, bare 56px rows with a rank.
        return (
          <>
            <div className="flex items-center justify-between h-[22px]">
              <PressBoxSkeletonBar className="h-[15px] w-[96px]" />
              <PressBoxSkeletonBar className="h-[22px] w-[120px] rounded-[6px]" />
            </div>
            <div className="mt-2.5 flex gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <PressBoxSkeletonBar key={i} className="h-[26px] w-[44px] rounded-full" style={stagger(i)} />
              ))}
            </div>
            <div
              className="grid grid-cols-[22px_1fr_44px_64px] gap-2 pt-3 pb-1 px-0.5 font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40"
              aria-hidden="true"
            >
              <span>#</span>
              <span>Player · team · pos</span>
              <span className="text-right">GP</span>
              <span className="text-right">PTS</span>
            </div>
            <PressBoxSkeletonRows rows={8} height={56} rank startIndex={7} />
          </>
        );
      case 'scores':
        // The Scores tab: the day strip, then the game tiles.
        return (
          <>
            <div className="flex items-center justify-between">
              <PressBoxSkeletonBar className="h-[12px] w-[12px]" />
              <PressBoxSkeletonBar className="h-[15px] w-[140px]" />
              <PressBoxSkeletonBar className="h-[12px] w-[12px]" />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <PressBoxSkeletonCard key={i} height={92} index={i} />
              ))}
            </div>
          </>
        );
      case 'news':
        // The News tab: the category chips, ON THE WIRE, the lead tile, rows.
        return (
          <>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <PressBoxSkeletonBar key={i} className="h-[26px] w-[64px] rounded-full" style={stagger(i)} />
              ))}
            </div>
            <PressBoxSkeletonHead className="mt-3.5" width={100} />
            <div className="mt-2.5 flex flex-col gap-2">
              <PressBoxSkeletonCard height={220} lines={3} className="justify-end" index={1} />
              {[2, 3, 4].map((i) => (
                <PressBoxSkeletonCard key={i} height={84} index={i} />
              ))}
            </div>
          </>
        );
      case 'home':
        // Home: the ticker, MY LEAGUES, the league cards, TONIGHT ON YOUR ROSTERS.
        return (
          <>
            <PressBoxSkeletonBar className="h-[28px] w-full rounded-[6px]" />
            <PressBoxSkeletonHead className="mt-4" width={88} />
            <div className="mt-2 flex flex-col gap-2">
              {[1, 2].map((i) => (
                <PressBoxSkeletonCard key={i} height={96} index={i} />
              ))}
            </div>
            <PressBoxSkeletonHead className="mt-5" width={168} />
            <PressBoxSkeletonList className="mt-2" rows={4} height={56} startIndex={3} />
          </>
        );
      case 'account':
        // Account: the identity row, the stat tiles, then setting groups.
        return (
          <>
            <div className="flex items-center gap-3">
              <span className="w-14 h-14 rounded-full pb-shimmer border-[1.5px] border-white/[0.16]" />
              <span className="flex flex-col gap-1.5">
                <PressBoxSkeletonBar className="h-[18px] w-[140px]" />
                <PressBoxSkeletonBar className="h-[10px] w-[90px]" />
              </span>
            </div>
            <PressBoxSkeletonTiles className="mt-4" />
            {[1, 2, 3].map((g) => (
              <div key={g} className="mt-4">
                <PressBoxSkeletonBar className="h-[9px] w-[64px] mb-2" style={stagger(g)} />
                <PressBoxSkeletonList rows={3} height={52} mug={false} startIndex={g * 3} />
              </div>
            ))}
          </>
        );
      case 'bracket':
        return (
          <>
            <PressBoxSkeletonHead width={120} />
            <PressBoxSkeletonBar className="mt-2 h-[10px] w-[48%]" />
            <div className="mt-3 flex flex-col gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <PressBoxSkeletonCard key={i} height={88} index={i} />
              ))}
            </div>
          </>
        );
      case 'list':
      default:
        return <PressBoxSkeletonList rows={8} />;
    }
  })();
  return (
    <div className={cn(PB_TYPE, 'px-3.5 pt-3 pb-app-chrome', className)} role="status" aria-label="Loading" data-testid={`pb-skeleton-${kind}`}>
      {body}
    </div>
  );
}
