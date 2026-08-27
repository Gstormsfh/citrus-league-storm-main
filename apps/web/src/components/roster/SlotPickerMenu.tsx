import { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ArrowRightLeft, Check } from 'lucide-react';
import type { HockeyPlayer } from './HockeyPlayerCard';
import { slotLabel } from './slotLabel';

/**
 * SLOT PICKER (2026-08-27)
 *
 * Reported as "it's still a bit complicated — we need to essentially click,
 * then open a mini menu of those available roster slots."
 *
 * The tap-to-swap flow that preceded this asks the manager to hold state in
 * their head. Tap a player, and the eligible slots light up SOMEWHERE ELSE on
 * a list that on a phone is several screens long. You then scroll hunting for
 * a highlight, having lost sight of the player you selected. On a 12-slot
 * roster with a bench, the target is frequently off-screen at the moment it
 * becomes relevant.
 *
 * This anchors the choice to the thing you tapped.
 *
 * WHAT IT ADDS BEYOND CONVENIENCE
 * ────────────────────────────────
 * The highlight-based flow can only express "this slot is legal". It cannot
 * tell you WHO IS ALREADY THERE, so a swap's consequence is invisible until
 * after you commit it — you find out you just benched your best defenceman by
 * watching him leave. A menu has room to name the occupant, so the trade is
 * legible before the tap rather than after:
 *
 *     D1   Cale Makar
 *     D2   Quinn Hughes
 *     D3   Empty
 *
 * Eligibility is NOT recomputed here. `eligibleSlots` comes from Roster.tsx's
 * `tapEligibleSlots`, which is the same set the highlight path uses and the
 * only place `isPositionValid` is consulted — including the `is_ir_eligible`
 * gate on IR slots. A second implementation would be a second thing to drift.
 */

export interface SlotPickerMenuProps {
  /** The player being moved. Null closes the menu. */
  player: HockeyPlayer | null;
  /** Slot ids this player may legally occupy — Roster.tsx's `tapEligibleSlots`. */
  eligibleSlots: Set<string>;
  /** playerId -> slotId for everyone on the roster, used to name occupants. */
  slotAssignments: Record<string | number, string>;
  /** Every player on the roster, for occupant lookup. */
  allPlayers: HockeyPlayer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (slotId: string) => void;
  children: React.ReactNode;
}


type Group = { key: string; heading: string | null; slots: string[] };

/**
 * Group in the order the roster itself reads top to bottom, so the menu and
 * the page underneath agree. A manager who has just scrolled past Forwards,
 * Defense and Goalies should not meet them in a different order here.
 */
function groupSlots(slots: string[]): Group[] {
  const isFwd = (s: string) => /^slot-(C|LW|RW|F)-/.test(s);
  //
  // Bench and IR carry NO heading. They are single destinations whose row
  // label already names them, and a group called "Bench" containing one row
  // labelled "Bench" reads as a bug. They share one trailing section, set off
  // by a rule, because both are "off the active lineup" rather than a
  // position.
  const groups: Group[] = [
    { key: 'fwd', heading: 'Forwards', slots: slots.filter(isFwd) },
    { key: 'def', heading: 'Defense', slots: slots.filter((s) => s.startsWith('slot-D-')) },
    { key: 'g', heading: 'Goalies', slots: slots.filter((s) => s.startsWith('slot-G-')) },
    { key: 'util', heading: 'Utility', slots: slots.filter((s) => s.startsWith('slot-UTIL')) },
    {
      key: 'off',
      heading: null,
      slots: [
        ...slots.filter((s) => s === 'bench-grid'),
        ...slots.filter((s) => s.startsWith('ir-slot-')),
      ],
    },
  ];
  return groups.filter((g) => g.slots.length > 0);
}

export function SlotPickerMenu({
  player,
  eligibleSlots,
  slotAssignments,
  allPlayers,
  open,
  onOpenChange,
  onPick,
  children,
}: SlotPickerMenuProps) {
  /** slotId -> the player sitting in it. Bench holds many; it is not listed. */
  const occupants = useMemo(() => {
    const map = new Map<string, HockeyPlayer>();
    for (const p of allPlayers) {
      const slot = slotAssignments[p.id];
      if (slot && slot !== 'bench-grid') map.set(slot, p);
    }
    return map;
  }, [allPlayers, slotAssignments]);

  /** The bench holds many players, so it reports a count rather than a name.
   *  Rendering "Empty" for it would be a false claim about occupancy. */
  const benchCount = useMemo(
    () => allPlayers.filter((p) => slotAssignments[p.id] === 'bench-grid').length,
    [allPlayers, slotAssignments],
  );

  const currentSlot = player ? slotAssignments[player.id] : undefined;

  const groups = useMemo(
    () => groupSlots([...eligibleSlots].sort()),
    [eligibleSlots],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 p-0 bg-[#16281D] border-white/10 max-h-[60dvh] overflow-y-auto overscroll-contain"
      >
        <div className="px-3 py-2 border-b border-white/10 sticky top-0 bg-[#16281D] z-10">
          <p className="text-[10px] font-jbmono uppercase tracking-[0.18em] text-white/55">
            Move
          </p>
          <p className="text-sm font-display font-bold text-pastel-cream truncate">
            {player?.name ?? ''}
          </p>
        </div>

        {groups.length === 0 ? (
          // Reachable: a locked player, or one whose only legal slot is the
          // one he already occupies. Saying so beats an empty box.
          <p className="px-3 py-4 text-xs text-white/55">
            No other slots are open to this player right now.
          </p>
        ) : (
          groups.map((group) => (
            <div
              key={group.key}
              className={cn('py-1', group.heading === null && 'border-t border-white/10')}
            >
              {group.heading !== null && (
                <p className="px-3 py-1 text-[9px] font-jbmono uppercase tracking-[0.2em] text-white/55">
                  {group.heading}
                </p>
              )}
              {group.slots.map((slotId) => {
                const occupant = occupants.get(slotId);
                const isCurrent = slotId === currentSlot;
                return (
                  <button
                    key={slotId}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      onPick(slotId);
                      onOpenChange(false);
                    }}
                    // 44px min height: this is a thumb target on a phone.
                    className={cn(
                      'w-full flex items-center gap-2 px-3 min-h-[44px] text-left transition-colors',
                      isCurrent
                        ? 'opacity-55 cursor-default'
                        : 'hover:bg-white/5 active:bg-white/10',
                    )}
                  >
                    <span className="w-11 shrink-0 font-jbmono text-[11px] font-bold tracking-wide text-pastel-sage">
                      {slotLabel(slotId)}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[13px] text-pastel-cream">
                      {slotId === 'bench-grid' ? (
                        <span className="text-white/55">
                          {benchCount === 1 ? '1 player' : `${benchCount} players`}
                        </span>
                      ) : occupant ? (
                        occupant.name
                      ) : (
                        <span className="text-white/55 italic">Empty</span>
                      )}
                    </span>
                    {isCurrent ? (
                      <Check className="w-3.5 h-3.5 shrink-0 text-pastel-sage" aria-hidden="true" />
                    ) : occupant && slotId !== 'bench-grid' ? (
                      // Names the consequence: this is a swap, not a move into
                      // an empty slot, and the occupant is going where you came
                      // from.
                      <ArrowRightLeft
                        className="w-3.5 h-3.5 shrink-0 text-white/55"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

export default SlotPickerMenu;
