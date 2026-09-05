/**
 * THE WAIVER WIRE ON A PHONE (2026-09-04).
 *
 * The league menu's `Waivers` tile lands here. No artboard draws the
 * screen, so it is built from the ones that do, in the order a manager
 * needs it: the two facts first — YOUR PRIORITY (or the FAAB budget, with
 * the bar the artboard gives every budget) and the NEXT RUN — then the
 * rules as rows, then the wire itself: a search row, the position chips,
 * and one row per available player with the figure that matters (points,
 * or wins for a goalie) and an ADD / CLAIM pill; then your claims, the
 * pending ones first with their CANCEL, the last ten settled ones under
 * them at half strength.
 *
 * Claiming is a bottom sheet rather than a card that appears under the
 * list: the bid stepper, the drop picker and SUBMIT sit where the thumb
 * is, over the list that stays put. Nothing submits until SUBMIT.
 *
 * Every figure is the page's own state; the screen adds none.
 */
import { useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxSkeletonRows } from '@/components/pressbox/Skeleton';
import { PressBoxSheet } from '@/components/pressbox/Sheet';
import { PressBoxOptionSheet, PressBoxSaveBar, PressBoxSettingGroup, PressBoxSettingRow } from '@/components/pressbox/Settings';
import { pressBoxPositionChipClasses, positionChipKey } from '@/components/pressbox/positionChip';
import type { WaiverClaim } from '@/services/WaiverService';

/** The wire's row, as WaiverService.getAvailablePlayers hands it. */
export interface WirePlayer {
  player_id: number;
  full_name: string;
  position_code?: string | null;
  team_abbrev?: string | null;
  is_goalie?: boolean;
  games_played?: number | null;
  points?: number | null;
  wins?: number | null;
  save_percentage?: number | null;
}

export interface RosterDropOption {
  player_id: number;
  full_name: string;
  position_code?: string | null;
  team_abbrev?: string | null;
}

export interface ClaimPlayerRef {
  full_name: string;
  position?: string | null;
  team?: string | null;
}

export interface WaiversPhoneProps {
  loading: boolean;
  myPriority: number | null;
  teamCount: number;
  isFAAB: boolean;
  faabBudget: number | null;
  /** `2:00 AM MT`. */
  processTime: string;
  periodHours: number;
  gameLock: boolean;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  positions: ReadonlyArray<{ key: string; label: string }>;
  position: string;
  onPosition: (key: string) => void;
  players: WirePlayer[];
  playersLoading: boolean;
  lockedTeams: Set<string>;
  /** player_id → ISO clear time, for a player still in the waiver window. */
  clearsAt: Map<string, string>;
  formatMoment: (iso?: string | null) => string | null;
  selected: WirePlayer | null;
  onSelect: (p: WirePlayer | null) => void;
  roster: RosterDropOption[];
  dropPlayerId: number | null;
  onDropPlayer: (id: number | null) => void;
  bidAmount: number;
  onBidAmount: (n: number) => void;
  onSubmit: () => void;
  claims: WaiverClaim[];
  claimPlayers: Map<number, ClaimPlayerRef>;
  onCancelClaim: (id: string) => void;
  nextRunFor: (claim: WaiverClaim) => string | null;
  /** Rendered above everything for a signed-out visitor. */
  banner?: React.ReactNode;
  className?: string;
}

const TILE = 'p-2.5 rounded-[10px] bg-pressbox-tile border border-white/[0.08]';
const LABEL = 'font-plex font-medium text-[8px] tracking-[0.08em] text-pressbox-text/45 uppercase';
const FIGURE = 'mt-[3px] font-plex font-semibold text-[18px] tabular-nums leading-none';

const STATUS_TAG: Record<WaiverClaim['status'], string> = {
  pending: 'bg-pressbox-orange/15 text-pressbox-orange-soft',
  successful: 'bg-pressbox-sage/15 text-pressbox-sage-soft',
  failed: 'bg-pressbox-grapefruit/[0.15] text-pressbox-grapefruit-text',
  cancelled: 'bg-white/[0.06] text-pressbox-text/50',
};

export function WaiversPhone(p: WaiversPhoneProps) {
  const [picker, setPicker] = useState<'drop' | null>(null);

  const pending = p.claims.filter((c) => c.status === 'pending');
  const settled = p.claims.filter((c) => c.status !== 'pending').slice(0, 10);
  const budgetPct = p.faabBudget == null ? 0 : Math.max(0, Math.min(100, p.faabBudget));

  const dropOptions = [
    { value: 'none', label: 'No drop', help: 'Only if the roster has an open spot' },
    ...p.roster.map((r) => ({
      value: String(r.player_id),
      label: r.full_name,
      help: [r.position_code, r.team_abbrev].filter(Boolean).join(' · '),
    })),
  ];
  const dropLabel = p.dropPlayerId == null ? 'None' : p.roster.find((r) => r.player_id === p.dropPlayerId)?.full_name ?? 'None';

  const clampBid = (n: number) => Math.max(0, Math.min(p.faabBudget ?? 0, Math.round(n)));

  return (
    <div data-testid="waivers-phone" className={cn(PB_TYPE, 'px-3.5 pt-3', p.className)}>
      {p.banner}

      {/* The two facts. */}
      <div className="grid grid-cols-2 gap-1.5" data-testid="waivers-phone-facts">
        {p.isFAAB ? (
          <div className={TILE}>
            <p className={LABEL}>FAAB budget</p>
            <p className={cn(FIGURE, 'text-pressbox-orange-soft')}>
              {p.faabBudget == null ? '–' : `$${p.faabBudget}`}
              <span className="ml-1 font-medium text-[9px] text-pressbox-text/45">OF $100</span>
            </p>
            <div className="mt-2 h-[3px] rounded-[2px] bg-white/[0.08] overflow-hidden">
              <div className="h-full bg-pressbox-orange-soft" style={{ width: `${budgetPct}%` }} />
            </div>
          </div>
        ) : (
          <div className={TILE}>
            <p className={LABEL}>Your priority</p>
            <p className={cn(FIGURE, 'text-pressbox-sage')}>
              {p.loading ? '…' : p.myPriority == null ? '–' : `#${p.myPriority}`}
              {p.teamCount > 0 && <span className="ml-1 font-medium text-[9px] text-pressbox-text/45">OF {p.teamCount}</span>}
            </p>
          </div>
        )}
        <div className={TILE}>
          <p className={LABEL}>Next run</p>
          <p className={cn(FIGURE, 'text-pressbox-text')}>{p.processTime}</p>
          <p className="mt-1 font-plex font-medium text-[9px] text-pressbox-text/45">DAILY</p>
        </div>
      </div>

      <PressBoxSettingGroup className="mt-3" label="THE RULES">
        <PressBoxSettingRow label="Waiver period" help="How long a dropped player sits on waivers" value={`${p.periodHours} hours`} />
        <PressBoxSettingRow label="Game lock" help="Players lock at puck drop" value={p.gameLock ? 'On' : 'Off'} last />
      </PressBoxSettingGroup>

      {/* The wire. */}
      <PressBoxSectionHead
        className="mt-4"
        title={p.searchQuery ? 'Results' : 'Available'}
        count={!p.playersLoading && p.players.length > 0 ? String(p.players.length) : null}
      />
      <div className="mt-2 flex items-center gap-2 h-[38px] px-3 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
        <Search className="w-[15px] h-[15px] text-pressbox-text/45" strokeWidth={2} aria-hidden />
        <input
          type="search"
          value={p.searchQuery}
          onChange={(e) => p.onSearchQuery(e.target.value)}
          placeholder="Search the wire…"
          aria-label="Search available players"
          data-testid="waivers-phone-search"
          className="flex-1 min-w-0 bg-transparent font-barlow text-[14px] text-pressbox-text placeholder:text-pressbox-text/45 outline-none"
        />
        {p.searchQuery && (
          <button
            type="button"
            onClick={() => p.onSearchQuery('')}
            className="focus-citrus font-plex font-semibold text-[9px] tracking-[0.08em] text-pressbox-text/55 uppercase"
          >
            Clear
          </button>
        )}
      </div>
      <div className="mt-2 -mx-3.5 py-2.5 -my-2.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PressBoxChips
          chips={p.positions.map((x) => ({ key: x.key, label: x.label }))}
          activeKey={p.position}
          onSelect={p.onPosition}
          label="Position filter"
          outlined
          compact
          className="w-max min-w-full px-3.5"
        />
      </div>

      {p.playersLoading && p.players.length === 0 ? (
        <div className="mt-2" data-testid="waivers-phone-loading">
          <PressBoxSkeletonRows rows={6} height={56} />
        </div>
      ) : p.players.length === 0 ? (
        <div className="mt-2 px-4 py-8 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="waivers-phone-empty">
          <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">
            {p.searchQuery ? 'Nothing matched' : 'The wire is empty'}
          </p>
          <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">
            {p.searchQuery ? `No available player matched “${p.searchQuery}”.` : 'No available players right now.'}
          </p>
        </div>
      ) : (
        <ul className="mt-2 border-b border-white/[0.06]" data-testid="waivers-phone-list">
          {p.players.map((pl) => {
            const locked = !!pl.team_abbrev && p.lockedTeams.has(pl.team_abbrev);
            const clears = p.clearsAt.get(String(pl.player_id)) ?? null;
            const onWire = locked || clears !== null;
            const goalie = pl.is_goalie || pl.position_code === 'G';
            const gp = Number(pl.games_played ?? 0);
            const figure = goalie ? Number(pl.wins ?? 0) : Number(pl.points ?? 0);
            const meta = [
              pl.team_abbrev,
              gp > 0 ? `${gp} GP` : null,
              goalie && pl.save_percentage ? `${(pl.save_percentage * 100).toFixed(1)} SV%` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            const note = clears !== null ? `On waivers · clears ${p.formatMoment(clears) ?? 'soon'}` : locked ? 'Game-locked' : null;
            return (
              <li key={pl.player_id} data-testid="waivers-phone-row" className="border-t border-white/[0.06]">
                <div className="flex items-center gap-2.5 min-h-[56px] py-1.5 px-0.5">
                  <span className={pressBoxPositionChipClasses(positionChipKey(pl.position_code ?? ''))}>{pl.position_code ?? '–'}</span>
                  <button
                    type="button"
                    onClick={() => p.onSelect(pl)}
                    aria-label={`${onWire ? 'Claim' : 'Add'} ${pl.full_name}`}
                    className="focus-citrus flex-1 min-w-0 text-left"
                  >
                    <span className="block font-barlow font-bold text-[14px] leading-tight text-pressbox-text truncate">{pl.full_name}</span>
                    <span className="block mt-0.5 font-plex font-medium text-[10px] text-pressbox-text/50 tabular-nums truncate">
                      {meta}
                      {note && <span className="text-pressbox-orange-soft">{meta ? ' · ' : ''}{note}</span>}
                    </span>
                  </button>
                  <span className="text-right flex-none">
                    <span className="block font-plex font-semibold text-[17px] tabular-nums leading-none text-pressbox-text">{figure}</span>
                    <span className="block mt-0.5 font-plex font-medium text-[8px] tracking-[0.08em] text-pressbox-text/45 uppercase">
                      {goalie ? 'W' : 'PTS'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => p.onSelect(pl)}
                    className={cn(
                      'focus-citrus flex-none h-8 px-3 rounded-full border font-plex font-semibold text-[10px] tracking-[0.08em]',
                      onWire
                        ? 'border-pressbox-orange-soft/40 text-pressbox-orange-soft'
                        : 'border-white/[0.14] text-pressbox-text',
                    )}
                  >
                    {onWire ? 'CLAIM' : 'ADD'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Your claims. */}
      <PressBoxSectionHead className="mt-5" title="Your claims" count={pending.length > 0 ? `${pending.length} pending` : null} />
      {pending.length === 0 && settled.length === 0 ? (
        <p className="mt-2 px-4 py-6 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center font-barlow text-[12px] text-pressbox-text/45" data-testid="waivers-phone-no-claims">
          No claims yet. Tap a player on the wire to make one.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5" data-testid="waivers-phone-claims">
          {[...pending, ...settled].map((c) => {
            const player = p.claimPlayers.get(c.player_id);
            const drop = c.drop_player_id ? p.claimPlayers.get(c.drop_player_id) : null;
            const isPending = c.status === 'pending';
            const nextRun = isPending ? p.nextRunFor(c) : null;
            return (
              <li
                key={c.id}
                data-testid="waivers-phone-claim"
                data-status={c.status}
                className={cn(
                  'p-3 rounded-[12px] bg-pressbox-tile border',
                  isPending ? 'border-pressbox-orange/30' : 'border-white/[0.08] opacity-60',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-barlow font-bold text-[14px] leading-tight text-pressbox-text truncate">
                      {player?.full_name ?? `Player #${c.player_id}`}
                    </p>
                    {player && (
                      <p className="mt-0.5 font-plex font-medium text-[10px] text-pressbox-text/50">
                        {[player.position, player.team].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {drop && (
                      <p className="mt-1 font-plex font-medium text-[10px] text-pressbox-grapefruit-text">
                        DROP {drop.full_name}
                        {p.isFAAB && c.is_conditional_drop ? ' · IF WON' : ''}
                      </p>
                    )}
                    <p className="mt-1 font-plex font-medium text-[10px] text-pressbox-text/45 tabular-nums">
                      {p.isFAAB ? `BID $${c.bid_amount ?? 0}` : `PRIORITY #${c.priority}`}
                      {nextRun ? ` · RUNS ${nextRun.toUpperCase()}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-none">
                    <span className={cn('px-1.5 py-0.5 rounded-[4px] font-plex font-semibold text-[8px] tracking-[0.1em] uppercase', STATUS_TAG[c.status])}>
                      {c.status}
                    </span>
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => p.onCancelClaim(c.id)}
                        className="focus-citrus h-7 px-2.5 rounded-full border border-pressbox-grapefruit/35 font-plex font-semibold text-[9px] tracking-[0.08em] text-pressbox-grapefruit-text"
                      >
                        CANCEL
                      </button>
                    )}
                  </div>
                </div>
                {c.status === 'failed' && c.failure_reason && (
                  <p className="mt-1.5 font-barlow text-[11px] text-pressbox-text/50">{c.failure_reason}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The claim sheet. */}
      <PressBoxSheet
        open={p.selected != null}
        onOpenChange={(o) => {
          if (!o) p.onSelect(null);
        }}
        title={p.isFAAB ? 'Place a bid' : 'Confirm claim'}
        shape="bottom"
      >
        {p.selected && (
          <div data-testid="waivers-phone-sheet" className="flex flex-col">
            <div className="px-3.5 pt-3.5">
              <p className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-orange-soft">
                {p.isFAAB ? 'FAAB BID' : 'WAIVER CLAIM'}
              </p>
              <p className="mt-0.5 font-condensed font-bold text-[20px] uppercase tracking-[0.03em] text-pressbox-text leading-tight">
                {p.selected.full_name}
              </p>
              <p className="font-plex font-medium text-[10px] text-pressbox-text/50">
                {[p.selected.position_code, p.selected.team_abbrev].filter(Boolean).join(' · ')}
              </p>
            </div>

            <div className="px-3.5 pt-3 flex flex-col gap-2">
              {p.isFAAB && (
                <div className={TILE}>
                  <p className={LABEL}>Bid · of ${p.faabBudget ?? 0} remaining</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Less"
                      onClick={() => p.onBidAmount(clampBid(p.bidAmount - 1))}
                      className="focus-citrus w-11 h-11 rounded-[10px] bg-white/[0.06] border border-white/[0.12] font-plex text-[18px] text-pressbox-text"
                    >
                      −
                    </button>
                    <label className="flex-1 flex items-center justify-center gap-1 h-11 rounded-[10px] bg-white/[0.04] border border-white/[0.08]">
                      <span className="sr-only">Bid amount</span>
                      <span className="font-plex font-medium text-[14px] text-pressbox-text/50">$</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={p.faabBudget ?? 0}
                        value={p.bidAmount}
                        onChange={(e) => p.onBidAmount(clampBid(Number(e.target.value) || 0))}
                        data-testid="waivers-phone-bid"
                        className="w-20 bg-transparent text-center font-plex font-semibold text-[20px] tabular-nums text-pressbox-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </label>
                    <button
                      type="button"
                      aria-label="More"
                      onClick={() => p.onBidAmount(clampBid(p.bidAmount + 1))}
                      className="focus-citrus w-11 h-11 rounded-[10px] bg-white/[0.06] border border-white/[0.12] font-plex text-[18px] text-pressbox-text"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <PressBoxSettingGroup>
                <PressBoxSettingRow
                  label="Drop"
                  help={p.roster.length === 0 ? 'Your roster is empty' : 'Who leaves if the claim goes through'}
                  value={dropLabel}
                  onPress={p.roster.length > 0 ? () => setPicker('drop') : undefined}
                  last
                />
              </PressBoxSettingGroup>
            </div>

            <PressBoxSaveBar
              className="px-3.5 pt-3"
              discardLabel="CANCEL"
              saveLabel={p.isFAAB ? `SUBMIT $${p.bidAmount} BID` : 'SUBMIT CLAIM'}
              onDiscard={() => p.onSelect(null)}
              onSave={p.onSubmit}
            />
          </div>
        )}
      </PressBoxSheet>

      {picker === 'drop' && (
        <PressBoxOptionSheet
          open
          onOpenChange={(o) => !o && setPicker(null)}
          title="Drop"
          help="Who leaves if the claim goes through"
          options={dropOptions}
          value={p.dropPlayerId == null ? 'none' : String(p.dropPlayerId)}
          onSelect={(v) => p.onDropPlayer(v === 'none' ? null : Number(v))}
        />
      )}
    </div>
  );
}

export default WaiversPhone;
