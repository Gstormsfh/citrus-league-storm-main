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
import { X, ChevronDown } from 'lucide-react';
import { defaultLeagueTiles, type LeagueMenuTile } from './leagueMenuTiles';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';
import { PressBoxTile } from './Tile';

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
      className={cn(PB_TYPE, 'fixed inset-0 z-overlay bg-pressbox-surface flex flex-col', className)}
      role="dialog"
      aria-modal="true"
      aria-label={`${leagueName} menu`}
    >
      {/* THE LEAGUE IS THE TITLE, and it is CENTRED. The first draft put the
          crest pill next to the close button, left-aligned like a page
          header. Artboard 1a centres it and sets a fixed-width spacer on the
          right so it stays centred whatever the league is called — because
          this screen is not a page you navigated to, it is a switch you
          pulled, and the thing it is switched TO belongs in the middle. The
          crest, the name and `SWITCH` are one target: on a phone the whole
          pill is the tap, not a 12px chevron inside it. */}
      <div className="flex items-center justify-between gap-2 px-3.5 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="focus-citrus relative flex-none text-pressbox-text/70 after:absolute after:-inset-[13px] after:content-['']"
          aria-label="Close menu"
        >
          <X className="w-[18px] h-[18px]" strokeWidth={2} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={onSwitchLeague}
          disabled={!onSwitchLeague}
          className="focus-citrus flex items-center gap-2 min-w-0 px-2.5 py-1.5 rounded-[10px] bg-pressbox-tile border border-white/10 disabled:cursor-default"
        >
          <span
            aria-hidden="true"
            className="w-[22px] h-[22px] flex-none rounded-[6px] bg-pressbox-tile-high flex items-center justify-center font-condensed font-extrabold text-[10px] text-pressbox-text"
          >
            {/* ONE initial, the same fallback `LeagueHeader` uses. The
                artboard shows `FZ` because its league has a chosen crest;
                two letters derived from the name is a different rule from the
                header's, and two crests for one league that disagree is worse
                than a plainer crest that always matches. */}
            {(leagueName || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="font-barlow font-bold text-[14px] text-pressbox-text truncate">
            {leagueName}
          </span>
          {onSwitchLeague && (
            <span className="flex items-center gap-0.5 flex-none font-plex font-medium text-[10px] uppercase tracking-[0.06em] text-pressbox-text/50">
              Switch
              <ChevronDown className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
            </span>
          )}
        </button>

        {/* The counterweight. 18px, the close glyph's width, so the pill sits
            on the screen's centre line and not 18px to the right of it. */}
        <span aria-hidden="true" className="flex-none w-[18px]" />
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 pt-4 pb-6">
        {/* The artboard's tile, now a component: `PressBoxTile`. The stat
            line is Barlow 400 at 11px and NOT mono — everywhere else in Press
            Box a number is mono because it is being compared column against
            column; here six unrelated numbers are read as sentences, and the
            mono face made them look like a table. */}
        <div className="grid grid-cols-2 gap-2">
          {items.map(({ key, title, to, Icon, stat }) => (
            <PressBoxTile key={key} title={title} stat={stat} to={to} Icon={Icon} onNavigate={onClose} />
          ))}
        </div>

        {user && (
          <Link
            to="/profile"
            onClick={onClose}
            className="focus-citrus mt-3.5 flex items-center gap-3 px-3.5 py-3 rounded-[14px] bg-pressbox-tile border border-white/[0.08]"
          >
            <span
              aria-hidden="true"
              className="w-10 h-10 flex-shrink-0 rounded-full bg-pressbox-orange/20 border-2 border-pressbox-orange flex items-center justify-center font-condensed font-bold text-[14px] text-pressbox-text"
            >
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-barlow font-bold text-[15px] text-pressbox-text truncate">
                {user.displayName}
              </span>
              <span className="block font-plex font-medium text-[10px] whitespace-nowrap overflow-hidden text-ellipsis text-pressbox-text/50">
                {[user.handle, typeof user.leagueCount === 'number' ? `${user.leagueCount} leagues` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {/* `PROFILE ›`, not a gear. The row already looks like a link;
                what it needed was to say WHERE it goes. The artboard spells
                it, and a word costs less width here than the ambiguity did. */}
            <span className="flex-none font-plex font-medium text-[10px] text-pressbox-orange-soft">
              PROFILE &rsaquo;
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default LeagueMenu;
