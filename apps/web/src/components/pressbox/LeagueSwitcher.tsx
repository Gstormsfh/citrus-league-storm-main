/**
 * THE LEAGUE SWITCHER (2026-09-05). See leagueSwitcherRows.ts for the report.
 *
 * A bottom sheet, opened from the league name in the header and from the
 * SWITCH ▾ pill in the league menu. Create / Join sits at the TOP, where
 * a manager with fourteen leagues can still reach it (the 09-01 iPhone
 * lesson), the leagues scroll under it, the active one is marked and
 * inert, and the foot goes to the full league list — artboard 1a's home,
 * which is where the Press Box keeps the cards.
 *
 * Presentational: the chrome resolves the leagues from the context and
 * decides where a pick goes (`leagueSwitchDestination`), so this file reads
 * no context and the pressbox barrel stays importable under the hermetic
 * test env.
 */
import { ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PressBoxSheet } from './Sheet';
import { PB_TYPE } from './rowScale';
import { leagueSwitcherRows, type SwitcherLeague } from './leagueSwitcherRows';

export interface PressBoxLeagueSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leagues: readonly SwitcherLeague[];
  activeId: string | null;
  onPick: (league: SwitcherLeague) => void;
  onCreate: () => void;
  onAllLeagues?: () => void;
}

export function PressBoxLeagueSwitcher({ open, onOpenChange, leagues, activeId, onPick, onCreate, onAllLeagues }: PressBoxLeagueSwitcherProps) {
  const rows = leagueSwitcherRows(leagues, activeId);
  return (
    <PressBoxSheet open={open} onOpenChange={onOpenChange} title="Switch league" shape="bottom" className="lg:max-w-[480px] lg:mx-auto">
      <div className={cn(PB_TYPE, 'px-3.5 pt-4')} data-testid="league-switcher">
        <p className="font-plex font-semibold text-[9px] tracking-[0.14em] uppercase text-pressbox-orange-soft">
          My leagues · {rows.length}
        </p>
        <h2 className="mt-1 font-condensed font-extrabold text-[24px] uppercase tracking-[0.02em] leading-none text-pressbox-text">
          Switch league
        </h2>

        <button
          type="button"
          onClick={onCreate}
          data-testid="league-switcher-create"
          className="focus-citrus mt-3.5 w-full min-h-[48px] rounded-[12px] bg-pressbox-orange text-pressbox-orange-ink flex items-center justify-center gap-2 font-plex font-semibold text-[12px] tracking-[0.08em] uppercase"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
          Create / Join League
        </button>

        {rows.length > 0 && (
          <ul
            className="mt-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08] divide-y divide-white/[0.06] max-h-[min(50vh,360px)] overflow-y-auto overscroll-contain"
            aria-label="My leagues"
          >
            {rows.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(leagues[i])}
                  aria-current={r.active ? 'true' : undefined}
                  className={cn(
                    'focus-citrus w-full flex items-center gap-2.5 min-h-[52px] px-3.5 text-left',
                    r.active && 'bg-pressbox-orange/10',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-[30px] h-[30px] flex-none rounded-[7px] bg-pressbox-tile-high ring-1 ring-white/[0.08] flex items-center justify-center font-condensed font-extrabold text-[13px] text-pressbox-text',
                      r.active && 'ring-pressbox-orange/50',
                    )}
                  >
                    {r.initial}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-barlow font-bold text-[15px] leading-tight text-pressbox-text truncate">{r.name}</span>
                    <span className="block mt-0.5 font-plex font-medium text-[10px] tracking-[0.08em] uppercase text-pressbox-text/50">{r.line}</span>
                  </span>
                  {r.active ? (
                    <span className="flex-none font-plex font-semibold text-[9px] tracking-[0.1em] uppercase text-pressbox-sage">Active</span>
                  ) : (
                    <ChevronRight className="w-4 h-4 flex-none text-pressbox-text/35" strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {onAllLeagues && (
          <button
            type="button"
            onClick={onAllLeagues}
            className="focus-citrus mt-2 w-full min-h-[44px] flex items-center justify-center gap-1 font-plex font-semibold text-[10px] tracking-[0.08em] uppercase text-pressbox-text/60"
          >
            All leagues
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </PressBoxSheet>
  );
}

export default PressBoxLeagueSwitcher;
