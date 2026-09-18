/**
 * WeekStrip: the seven-day schedule read-out in the Team Intel card.
 *
 * Pure. The card lives in a 200-240px sidebar on GM Office and Roster, and
 * the previous seven-column grid came out at ~22px a column there: day
 * names truncated, "yours" running into its neighbours, OFF pills on top of
 * the numbers (desktop QA, 2026-09-18). One row per day reads at any width:
 * day, a heat bar with the league-wide game count, and your own count.
 */

export interface WeekStripDay {
  /** YYYY-MM-DD, compared to `todayStr` for the highlight. */
  dateStr: string;
  /** Weekday name; the first three letters are shown. */
  dayLabel: string;
  /** NHL games that day. */
  totalGames: number;
  /** Games your roster plays that day. */
  rosterGames: number;
}

interface WeekStripProps {
  days: WeekStripDay[];
  /** YYYY-MM-DD for today; the matching row is highlighted. */
  todayStr: string;
}

/** Off-night: three games or fewer. Same threshold the insights use. */
export const OFF_NIGHT_MAX_GAMES = 3;

export function heatColorFor(totalGames: number): string {
  if (totalGames >= 4) return 'hsl(142, 52%, 45%)';
  if (totalGames >= 2) return 'hsl(45, 85%, 55%)';
  return 'hsl(0, 72%, 58%)';
}

/**
 * Bar scale: the busiest day of the week fills the track, with a floor so a
 * quiet week does not paint every day as full.
 */
export function weekMaxFor(days: ReadonlyArray<Pick<WeekStripDay, 'totalGames'>>): number {
  return Math.max(8, ...days.map((day) => day.totalGames));
}

export function WeekStrip({ days, todayStr }: WeekStripProps) {
  const weekMax = weekMaxFor(days);
  return (
    <div className="rounded-md border border-border bg-muted/20 px-1.5 py-1.5" data-testid="week-strip">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Day</span>
        <span>NHL</span>
        <span className="text-right">Yours</span>
      </div>
      <div className="space-y-0.5">
        {days.map((day) => {
          const isOffNight = day.totalGames > 0 && day.totalGames <= OFF_NIGHT_MAX_GAMES;
          const heatColor = heatColorFor(day.totalGames);
          const isToday = day.dateStr === todayStr;
          const fillPct = day.totalGames === 0 ? 0 : Math.max(8, Math.round((day.totalGames / weekMax) * 100));
          return (
            <div
              key={day.dateStr}
              data-testid="week-strip-day"
              data-today={isToday ? 'true' : undefined}
              data-off-night={isOffNight ? 'true' : undefined}
              className={`grid grid-cols-[2rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 rounded px-1 py-0.5 ${
                isToday ? 'bg-citrus-orange/10 ring-1 ring-citrus-orange/40' : ''
              }`}
              title={`${day.dayLabel}: ${day.totalGames} NHL games, ${day.rosterGames} on your roster${isOffNight ? ' (off-night)' : ''}`}
            >
              <span
                className={`text-[11px] font-semibold uppercase leading-none ${
                  isToday ? 'text-citrus-orange' : 'text-muted-foreground'
                }`}
              >
                {day.dayLabel.slice(0, 3)}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60" aria-hidden="true">
                  <span className="block h-full rounded-full" style={{ width: `${fillPct}%`, backgroundColor: heatColor }} />
                </span>
                <span className="w-4 text-right text-[11px] font-bold leading-none tabular-nums" style={{ color: heatColor }}>
                  {day.totalGames}
                </span>
              </span>
              <span className="flex items-center justify-end gap-1 text-[11px] leading-none tabular-nums">
                {isOffNight && (
                  <span className="rounded-sm bg-red-950/40 px-1 py-px text-[8px] font-bold uppercase leading-none text-red-400">
                    Off
                  </span>
                )}
                <span className={day.rosterGames === 0 ? 'text-muted-foreground' : 'font-semibold text-foreground'}>
                  {day.rosterGames}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
