/**
 * THE TRADE CENTER ON A PHONE (2026-09-04).
 *
 * The league menu's `Trades` tile. No artboard draws it, so it is built
 * from the ones that do. Two tabs on the orange underline: PROPOSE and
 * OFFERS · n.
 *
 * PROPOSE reads top to bottom the way a trade is built: pick the partner
 * (a picker row), then YOU SEND — your roster, each row a toggle with a
 * check that goes grapefruit when a player is in the deal — then YOU GET,
 * the partner's roster with the check in sage, then the take in a note
 * card with the three figures (the page's own points-based value), the
 * message, and PROPOSE TRADE. The old phone stacked three desktop columns
 * and a grid toggle; the thing a thumb needs is one list at a time.
 *
 * OFFERS is the pending ones first — received, with ACCEPT / REJECT;
 * sent, with CANCEL — each a tile that says who and what, then the
 * settled ones at half strength. The league-vote review block the page
 * already has mounts above them, unchanged.
 *
 * Every figure is the page's; a face tap opens the shared card.
 */
import { useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxTabs } from '@/components/pressbox/Tabs';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxSkeletonRows } from '@/components/pressbox/Skeleton';
import { PressBoxNoteCard } from '@/components/pressbox/PlayerCard';
import { PressBoxOptionSheet, PressBoxSaveBar, PressBoxSettingGroup, PressBoxSettingRow } from '@/components/pressbox/Settings';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import type { Player } from '@/services/PlayerService';
import type { TradeOfferWithPlayers } from '@/services/TradeService';

export interface TradePartner {
  id: string | number;
  name: string;
  roster: Player[];
}

export interface TradesPhoneProps {
  tab: 'propose' | 'offers';
  onTab: (t: 'propose' | 'offers') => void;
  loading: boolean;
  draftNotCompleted: boolean;
  partners: TradePartner[];
  partnerId: string;
  onPartner: (id: string) => void;
  myRoster: Player[];
  mySelected: string[];
  onToggleMine: (id: string) => void;
  theirSelected: string[];
  onToggleTheirs: (id: string) => void;
  searchMine: string;
  onSearchMine: (q: string) => void;
  searchTheirs: string;
  onSearchTheirs: (q: string) => void;
  myValue: number;
  theirValue: number;
  opinion: string;
  message: string;
  onMessage: (m: string) => void;
  onPropose: () => void;
  onClear: () => void;
  onOpenPlayer: (p: Player) => void;
  offers: TradeOfferWithPlayers[];
  myTeamId: string | null;
  offersError: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
  /** The league-vote review block, mounted above the offers. */
  review?: React.ReactNode;
  banner?: React.ReactNode;
  className?: string;
}

const mugOf = (p: Player): MugPlayer => ({ name: p.full_name, image: p.headshot_url, team: p.team });

const STATUS_TAG: Record<string, string> = {
  pending: 'bg-pressbox-orange/15 text-pressbox-orange-soft',
  under_review: 'bg-pressbox-orange/15 text-pressbox-orange-soft',
  accepted: 'bg-pressbox-sage/15 text-pressbox-sage-soft',
  rejected: 'bg-pressbox-grapefruit/[0.15] text-pressbox-grapefruit-text',
  vetoed: 'bg-pressbox-grapefruit/[0.15] text-pressbox-grapefruit-text',
  cancelled: 'bg-white/[0.06] text-pressbox-text/50',
  expired: 'bg-white/[0.06] text-pressbox-text/50',
  countered: 'bg-white/[0.06] text-pressbox-text/50',
};

function RosterPick({
  players,
  selected,
  onToggle,
  onOpen,
  tone,
  emptyText,
}: {
  players: Player[];
  selected: string[];
  onToggle: (id: string) => void;
  onOpen: (p: Player) => void;
  tone: 'send' | 'get';
  emptyText: string;
}) {
  if (players.length === 0) {
    return <p className="mt-2 px-4 py-6 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center font-barlow text-[12px] text-pressbox-text/45">{emptyText}</p>;
  }
  return (
    <ul className="mt-2 border-b border-white/[0.06]">
      {players.map((p) => {
        const on = selected.includes(p.id);
        return (
          <li key={p.id} data-testid={`trade-${tone}-row`} data-selected={on} className="border-t border-white/[0.06]">
            <div className="flex items-center gap-2.5 min-h-[56px] py-1.5 px-0.5">
              <button type="button" onClick={() => onOpen(p)} aria-label={`Open player card for ${p.full_name}`} className="focus-citrus flex-none rounded-full">
                <Mug p={mugOf(p)} size="sm" crest />
              </button>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(p.id)}
                aria-label={`${on ? 'Remove' : 'Add'} ${p.full_name} ${tone === 'send' ? 'from what you send' : 'to what you get'}`}
                className="focus-citrus flex-1 min-w-0 flex items-center gap-2.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-barlow font-bold text-[14px] leading-tight text-pressbox-text truncate">{p.full_name}</span>
                  <span className="block mt-0.5 font-plex font-medium text-[10px] text-pressbox-text/50 tabular-nums truncate">
                    {[p.position, p.team, `${p.points ?? 0} PTS`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex-none w-6 h-6 rounded-full border flex items-center justify-center font-plex text-[12px]',
                    on
                      ? tone === 'send'
                        ? 'bg-pressbox-grapefruit border-pressbox-grapefruit text-[#2a0a0f]'
                        : 'bg-pressbox-sage border-pressbox-sage text-pressbox-surface'
                      : 'border-white/[0.16]',
                  )}
                >
                  {on ? '✓' : ''}
                </span>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SearchRow({ value, onChange, placeholder, testId }: { value: string; onChange: (v: string) => void; placeholder: string; testId: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 h-[36px] px-3 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
      <Search className="w-[14px] h-[14px] text-pressbox-text/45" strokeWidth={2} aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        className="flex-1 min-w-0 bg-transparent font-barlow text-[13px] text-pressbox-text placeholder:text-pressbox-text/45 outline-none"
      />
    </div>
  );
}

function PlayerLine({ players }: { players: TradeOfferWithPlayers['offered_players'] }) {
  if (players.length === 0) return <p className="font-barlow text-[12px] text-pressbox-text/45">Nothing</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {players.map((p) => (
        <li key={p.player_id} className="font-barlow font-semibold text-[13px] text-pressbox-text truncate">
          {p.full_name} <span className="font-plex font-medium text-[10px] text-pressbox-text/50">{p.position_code} · {p.team_abbrev}</span>
        </li>
      ))}
    </ul>
  );
}

export function TradesPhone(p: TradesPhoneProps) {
  const [picker, setPicker] = useState<'partner' | null>(null);
  const partner = p.partners.find((t) => String(t.id) === p.partnerId) ?? null;
  const q = (s: string) => s.trim().toLowerCase();
  const mine = p.myRoster.filter((x) => x.full_name.toLowerCase().includes(q(p.searchMine)));
  const theirs = (partner?.roster ?? []).filter((x) => x.full_name.toLowerCase().includes(q(p.searchTheirs)));
  const diff = p.theirValue - p.myValue;
  const ready = p.mySelected.length > 0 && p.theirSelected.length > 0 && partner != null;

  const received = p.offers.filter((o) => o.status === 'pending' && o.to_team_id === p.myTeamId);
  const sent = p.offers.filter((o) => o.status === 'pending' && o.from_team_id === p.myTeamId);
  const settled = p.offers.filter((o) => o.status !== 'pending' && o.status !== 'under_review');
  const pendingCount = received.length + sent.length;

  return (
    <div data-testid="trades-phone" className={cn(PB_TYPE, 'px-3.5 pt-2', p.className)}>
      {p.banner}
      <PressBoxTabs
        label="Trade center"
        tabs={[
          { key: 'propose', label: 'Propose' },
          { key: 'offers', label: pendingCount > 0 ? `Offers · ${pendingCount}` : 'Offers' },
        ]}
        activeKey={p.tab}
        onSelect={(k) => p.onTab(k as 'propose' | 'offers')}
      />

      {p.tab === 'propose' ? (
        p.draftNotCompleted ? (
          <div className="mt-3 px-4 py-8 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="trades-phone-predraft">
            <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">Trades open after the draft</p>
            <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">Rosters are set once every pick is in.</p>
          </div>
        ) : (
          <div data-testid="trades-phone-propose">
            <PressBoxSettingGroup className="mt-3">
              <PressBoxSettingRow
                label="Trading partner"
                help={partner ? `${partner.roster.length} on their roster` : 'Pick the team you are dealing with'}
                value={partner?.name ?? 'Choose'}
                onPress={() => setPicker('partner')}
                last
              />
            </PressBoxSettingGroup>

            <PressBoxSectionHead
              className="mt-4"
              title="You send"
              count={p.mySelected.length > 0 ? String(p.mySelected.length) : null}
              action={<span className="font-plex font-medium text-[10px] tracking-[0.06em] text-pressbox-text/45 tabular-nums">VAL {p.myValue}</span>}
            />
            <SearchRow value={p.searchMine} onChange={p.onSearchMine} placeholder="Search your roster" testId="trades-phone-search-mine" />
            {p.loading ? (
              <PressBoxSkeletonRows className="mt-2" rows={4} height={56} />
            ) : (
              <RosterPick
                players={mine}
                selected={p.mySelected}
                onToggle={p.onToggleMine}
                onOpen={p.onOpenPlayer}
                tone="send"
                emptyText={p.searchMine ? 'Nobody matches that search' : 'Your roster is empty'}
              />
            )}

            <PressBoxSectionHead
              className="mt-5"
              title="You get"
              count={p.theirSelected.length > 0 ? String(p.theirSelected.length) : null}
              action={<span className="font-plex font-medium text-[10px] tracking-[0.06em] text-pressbox-text/45 tabular-nums">VAL {p.theirValue}</span>}
            />
            {partner ? (
              <>
                <SearchRow value={p.searchTheirs} onChange={p.onSearchTheirs} placeholder={`Search ${partner.name}`} testId="trades-phone-search-theirs" />
                <RosterPick
                  players={theirs}
                  selected={p.theirSelected}
                  onToggle={p.onToggleTheirs}
                  onOpen={p.onOpenPlayer}
                  tone="get"
                  emptyText={p.searchTheirs ? 'Nobody matches that search' : 'Their roster is empty'}
                />
              </>
            ) : (
              <p className="mt-2 px-4 py-6 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center font-barlow text-[12px] text-pressbox-text/45">
                Pick a trading partner to see their roster.
              </p>
            )}

            <PressBoxSectionHead className="mt-5" title="The take" />
            <div className="mt-2 grid grid-cols-3 gap-1.5" data-testid="trades-phone-values">
              {[
                { label: 'YOU SEND', value: p.myValue, tone: 'text-pressbox-grapefruit-text' },
                { label: 'YOU GET', value: p.theirValue, tone: 'text-pressbox-sage' },
                { label: 'DIFF', value: diff > 0 ? `+${diff}` : String(diff), tone: diff >= 0 ? 'text-pressbox-sage' : 'text-pressbox-grapefruit-text' },
              ].map((t) => (
                <div key={t.label} className="p-2 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
                  <p className="font-plex font-medium text-[8px] tracking-[0.08em] text-pressbox-text/45">{t.label}</p>
                  <p className={cn('mt-[3px] font-plex font-semibold text-[18px] tabular-nums leading-none', t.tone)}>{t.value}</p>
                </div>
              ))}
            </div>
            <PressBoxNoteCard className="mt-2" eyebrow="STORMY · TRADE READ" body={p.opinion} avatarSrc="/mascots/mascot-stormy.webp" />

            <label className="block mt-3">
              <span className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-text/45">MESSAGE · OPTIONAL</span>
              <textarea
                value={p.message}
                onChange={(e) => p.onMessage(e.target.value)}
                rows={2}
                placeholder="Why this works for both of you"
                data-testid="trades-phone-message"
                className="mt-1 w-full px-3 py-2 rounded-[10px] bg-pressbox-tile border border-white/[0.08] font-barlow text-[13px] text-pressbox-text placeholder:text-pressbox-text/45 outline-none focus:border-white/[0.2]"
              />
            </label>

            <PressBoxSaveBar
              className="mt-3"
              discardLabel="CLEAR"
              saveLabel="PROPOSE TRADE"
              onDiscard={p.onClear}
              onSave={p.onPropose}
              saveDisabled={!ready}
            />
          </div>
        )
      ) : (
        <div data-testid="trades-phone-offers" className="mt-3 flex flex-col gap-4">
          {p.review}

          {p.offersError && p.offers.length === 0 ? (
            <div className="px-4 py-8 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center">
              <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">Offers did not load</p>
              <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">Pull down or come back in a moment.</p>
            </div>
          ) : p.offers.length === 0 ? (
            <div className="px-4 py-8 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="trades-phone-no-offers">
              <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">No offers yet</p>
              <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">Propose one, or wait for the league to come to you.</p>
            </div>
          ) : (
            <>
              {received.length > 0 && (
                <section>
                  <PressBoxSectionHead title="Received" count={String(received.length)} />
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {received.map((o) => (
                      <li key={o.id} data-testid="trades-phone-offer" data-direction="received" className="p-3 rounded-[12px] bg-pressbox-tile border border-pressbox-sage/35">
                        <p className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-sage">FROM {o.from_team_name.toUpperCase()}</p>
                        {o.message && <p className="mt-1 font-barlow italic text-[12px] text-pressbox-text/60">“{o.message}”</p>}
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div>
                            <p className="font-plex font-medium text-[8px] tracking-[0.1em] text-pressbox-sage mb-1">YOU GET</p>
                            <PlayerLine players={o.offered_players} />
                          </div>
                          <div>
                            <p className="font-plex font-medium text-[8px] tracking-[0.1em] text-pressbox-grapefruit-text mb-1">YOU SEND</p>
                            <PlayerLine players={o.requested_players} />
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2 font-plex font-semibold text-[11px] tracking-[0.06em]">
                          <button type="button" onClick={() => p.onAccept(o.id)} className="focus-citrus flex-1 h-10 rounded-[10px] bg-pressbox-sage text-pressbox-surface">
                            ACCEPT
                          </button>
                          <button type="button" onClick={() => p.onReject(o.id)} className="focus-citrus flex-1 h-10 rounded-[10px] border border-pressbox-grapefruit/35 text-pressbox-grapefruit-text">
                            REJECT
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {sent.length > 0 && (
                <section>
                  <PressBoxSectionHead title="Sent" count={String(sent.length)} />
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {sent.map((o) => (
                      <li key={o.id} data-testid="trades-phone-offer" data-direction="sent" className="p-3 rounded-[12px] bg-pressbox-tile border border-pressbox-orange/30">
                        <p className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-orange-soft">TO {o.to_team_name.toUpperCase()}</p>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div>
                            <p className="font-plex font-medium text-[8px] tracking-[0.1em] text-pressbox-grapefruit-text mb-1">YOU SEND</p>
                            <PlayerLine players={o.offered_players} />
                          </div>
                          <div>
                            <p className="font-plex font-medium text-[8px] tracking-[0.1em] text-pressbox-sage mb-1">YOU GET</p>
                            <PlayerLine players={o.requested_players} />
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <button type="button" onClick={() => p.onCancel(o.id)} className="focus-citrus h-8 px-3 rounded-full border border-pressbox-grapefruit/35 font-plex font-semibold text-[10px] tracking-[0.08em] text-pressbox-grapefruit-text">
                            CANCEL OFFER
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {settled.length > 0 && (
                <section>
                  <PressBoxSectionHead title="History" count={String(settled.length)} />
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {settled.slice(0, 10).map((o) => {
                      const mineSent = o.from_team_id === p.myTeamId;
                      return (
                        <li key={o.id} data-testid="trades-phone-offer" data-direction="settled" className="p-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08] opacity-60">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-plex font-semibold text-[9px] tracking-[0.14em] text-pressbox-text/60 truncate">
                              {mineSent ? `TO ${o.to_team_name.toUpperCase()}` : `FROM ${o.from_team_name.toUpperCase()}`}
                            </p>
                            <span className={cn('flex-none px-1.5 py-0.5 rounded-[4px] font-plex font-semibold text-[8px] tracking-[0.1em] uppercase', STATUS_TAG[o.status] ?? STATUS_TAG.cancelled)}>
                              {o.status.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="mt-1 font-barlow text-[12px] text-pressbox-text/70 truncate">
                            {o.offered_players.map((x) => x.full_name).join(', ') || 'Nothing'}
                            <span className="text-pressbox-text/40"> for </span>
                            {o.requested_players.map((x) => x.full_name).join(', ') || 'nothing'}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {picker === 'partner' && (
        <PressBoxOptionSheet
          open
          onOpenChange={(o) => !o && setPicker(null)}
          title="Trading partner"
          help="The team you are dealing with"
          options={p.partners.map((t) => ({ value: String(t.id), label: t.name, help: `${t.roster.length} on the roster` }))}
          value={p.partnerId}
          onSelect={p.onPartner}
        />
      )}
    </div>
  );
}

export default TradesPhone;
