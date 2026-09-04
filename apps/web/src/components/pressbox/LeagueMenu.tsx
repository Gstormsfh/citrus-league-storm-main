/**
 * LEAGUE MENU — Press Box, replaces the MobileMenuButton sheet (2026-09-04).
 *
 * A 2-column grid of tiles, each one a destination plus the single live number
 * that tells you whether you need to go there. The old sheet was a list of
 * links; the difference is that "Waivers" tells you nothing and "You're #7 ·
 * processes 2:00 AM MT" tells you whether to open it.
 *
 * TWO RULES THIS FILE ENFORCES BY CONSTRUCTION, both from the spec:
 *
 * 1. EVERY TAP TARGET ROUTES. `to` is required on a tile. There is no way to
 *    render a tile that goes nowhere, so `linkGraphIntegrity` sees every one
 *    of them and a dead tile fails the build rather than the user.
 *
 * 2. NO INVENTED NUMBERS. `stat` is optional and the line is omitted when it
 *    is absent. The spec names ten tiles with live stats; the repo has routes
 *    for four of them and aggregates for fewer. Shipping "Draft results ·
 *    Snake · 18 rds · grade B+" against no data would have been the exact
 *    thing rule 9 forbids, so the tiles whose routes do not exist are NOT
 *    here -- they are listed in PROGRESS.md with what each needs.
 *
 * Tiles are a prop rather than a constant so a screen can add one the moment
 * its route lands, without editing this file.
 */
import { Link } from 'react-router-dom';
import { X, ChevronDown, Settings } from 'lucide-react';
import { defaultLeagueTiles, type LeagueMenuTile } from './leagueMenuTiles';
import { cn } from '@/lib/utils';

export interface LeagueMenuProps {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  leagueName: string;
  onSwitchLeague?: () => void;
  /** Commissioner-only tiles are filtered by the caller, which knows the role. */
  tiles?: LeagueMenuTile[];
  /** Footer identity. */
  user?: { displayName: string; handle?: string | null; leagueCount?: number } | null;
  className?: string;
}

export function LeagueMenu({
  open,
  onClose,
  leagueId,
  leagueName,
  onSwitchLeague,
  tiles,
  user,
  className,
}: LeagueMenuProps) {
  if (!open) return null;
  const items = tiles ?? defaultLeagueTiles(leagueId);

  return (
    /*
     * `z-overlay` (100), not a number and not a new rung. `src/styles/zLayers.ts`
     * defines `overlay` as "full-window takeovers ... above the nav, below the
     * modal sheets", which is exactly what this is: it has to cover `app-nav`
     * (45) or the bottom nav prints through it, and it must stay under `sheet`
     * (9000) so a roster sheet opened from a menu destination still lands on
     * top. The first draft of this file invented `z-app-modal`, which is not a
     * rung — `zLayerScaleGuard` walks every fixed/sticky element in `src/` and
     * fails on any z-index name the scale does not define, which is how it was
     * caught. Adding a rung would have been the wrong fix twice over: the scale
     * already had the layer, and a rung between `app-nav` and `sheet` with no
     * argument for why it belongs there is how the old eleven-value mess grew.
     */
    <div
      className={cn('fixed inset-0 z-overlay bg-pressbox-surface flex flex-col', className)}
      role="dialog"
      aria-modal="true"
      aria-label={`${leagueName} menu`}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          onClick={onClose}
          className="focus-citrus min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-pressbox-text/55"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onSwitchLeague}
          disabled={!onSwitchLeague}
          className="focus-citrus flex items-center gap-2 min-w-0 h-9 px-3 rounded-full bg-pressbox-tile ring-1 ring-white/[0.08] disabled:cursor-default"
        >
          <span className="font-condensed font-bold text-[15px] uppercase tracking-[0.02em] text-pressbox-text truncate">
            {leagueName}
          </span>
          {onSwitchLeague && (
            <span className="flex items-center gap-0.5 font-plex font-medium text-[9px] uppercase tracking-[0.06em] text-pressbox-text/45">
              Switch
              <ChevronDown className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        <div className="grid grid-cols-2 gap-2">
          {items.map(({ key, title, to, Icon, stat }) => (
            <Link
              key={key}
              to={to}
              onClick={onClose}
              className="focus-citrus flex flex-col justify-between min-h-[88px] p-3 rounded-[14px] bg-pressbox-tile ring-1 ring-white/[0.08]"
            >
              <Icon className="w-[18px] h-[18px] text-pressbox-orange-soft" strokeWidth={2} aria-hidden="true" />
              <span className="mt-3">
                <span className="block font-barlow font-bold text-[15px] text-pressbox-text leading-tight">
                  {title}
                </span>
                {stat && (
                  <span className="block mt-0.5 font-plex font-medium text-[11px] leading-none whitespace-nowrap overflow-hidden text-ellipsis text-pressbox-text/55">
                    {stat}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>

        {user && (
          <Link
            to="/profile"
            onClick={onClose}
            className="focus-citrus mt-3 flex items-center gap-3 p-3 rounded-[14px] bg-pressbox-tile ring-1 ring-white/[0.08]"
          >
            <span
              aria-hidden="true"
              className="w-9 h-9 flex-shrink-0 rounded-full bg-pressbox-tile-high ring-1 ring-white/[0.08] flex items-center justify-center font-condensed font-extrabold text-[15px] text-pressbox-text"
            >
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-barlow font-bold text-[15px] text-pressbox-text truncate">
                {user.displayName}
              </span>
              <span className="block font-plex font-medium text-[10px] leading-none whitespace-nowrap overflow-hidden text-ellipsis text-pressbox-text/55">
                {[user.handle, typeof user.leagueCount === 'number' ? `${user.leagueCount} leagues` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <Settings className="w-4 h-4 flex-shrink-0 text-pressbox-text/45" strokeWidth={2} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}

export default LeagueMenu;
