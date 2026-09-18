// Draft Kit — Citrus's paid analytics section.
//
// ── WHAT THIS SECTION IS ─────────────────────────────────────────────
// The competitive frame is Yahoo's paid Fantasy Draft Kit and the card
// grammar is JFresh Hockey's. Both were researched on 2026-09-02 and what was
// taken from each is written down where it was used:
//
//   - components/draftkit/DraftKitPlayerCard.tsx  — the JFresh card grammar
//   - components/draftkit/DraftKitRankings.tsx    — the draft-kit tier board
//   - components/draftkit/tiers.ts                — the free / mid / top tier
//                                                   split Yahoo uses, and why
//                                                   no competitor price is
//                                                   quoted anywhere
//
// What was NOT taken from anyone: layout, colour, copy, models, thresholds,
// or any claim about anybody's accuracy.
//
// ── LEVERAGE, NOT DUPLICATION ────────────────────────────────────────
// The numbers come from the dashboards that already exist. The server's
// DraftKitService composes PlayerDashboardService's five-table join rather
// than re-implementing it, so a player's GAR is the same number here as it is
// on /players. The bars are the existing citrus2 PercentileBullet.
//
// ── THE GATE ─────────────────────────────────────────────────────────
// Entitlement is resolved server-side before the payload is assembled. An
// unentitled caller receives a different, smaller object; there is no full
// board behind a blur for a client to unmask.
//
// ── ART ──────────────────────────────────────────────────────────────
// The only images on this page are NHL player headshots from
// player_directory.headshot_url. The section hero has a marked placeholder
// where the founder's cover art goes. Nothing here is generated.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter } from '@/components/citrus2';
import {
  BlurbSlot,
  COHORT_LABEL,
  DraftKitPlayerCard,
  DraftKitPricing,
  DraftKitRankings,
  RosterChangeList,
  type Cohort,
} from '@/components/draftkit';
import { useDraftKitBoard } from '@/hooks/useDraftKitBoard';

const COHORTS: Cohort[] = ['F', 'D', 'G'];

type Tab = 'board' | 'changes' | 'reading' | 'pricing';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'board', label: 'Board' },
  { id: 'changes', label: 'Moves' },
  { id: 'reading', label: 'Reading' },
  { id: 'pricing', label: 'Pricing' },
];

export default function DraftKit() {
  const { board, loading, error } = useDraftKitBoard();
  const [params, setParams] = useSearchParams();
  const [cohort, setCohort] = useState<Cohort>('F');
  const [tab, setTab] = useState<Tab>('board');

  const selectedId = params.get('player') ? Number(params.get('player')) : null;

  const selected = useMemo(
    () => board?.cards.find((c) => c.playerId === selectedId) ?? null,
    [board, selectedId],
  );

  // Default the selection to the top of the visible cohort so the card slot is
  // never an empty box on first paint.
  useEffect(() => {
    if (!board || selected) return;
    const first = board.cards
      .filter((c) => c.cohort === cohort && c.cohortRank != null)
      .sort((a, b) => (a.cohortRank as number) - (b.cohortRank as number))[0];
    if (first) {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('player', String(first.playerId));
        return next;
      }, { replace: true });
    }
  }, [board, cohort, selected, setParams]);

  function select(playerId: number) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('player', String(playerId));
      return next;
    });
    const card = board?.cards.find((c) => c.playerId === playerId);
    if (card) setCohort(card.cohort);
  }

  const playerBlurbs = useMemo(
    () => (board && selected ? board.blurbs.filter((b) => b.playerId === selected.playerId) : []),
    [board, selected],
  );
  const generalBlurbs = useMemo(
    () => (board ? board.blurbs.filter((b) => b.playerId == null) : []),
    [board],
  );

  const seasonLabel = board
    ? `${board.projectionSeason}-${String(board.projectionSeason + 1).slice(2)}`
    : '';

  return (
    <DarkLayout>
      <Navbar />

      <main className="mx-auto w-full max-w-[1180px] px-4 pb-24 pt-24 sm:px-6">
        {/* Hero.
            ART PLACEHOLDER: the dashed panel below is where the founder's
            Draft Kit cover art goes. It is deliberately left as a labelled
            empty frame rather than filled with generated imagery. Drop a file
            into apps/web/public/ and swap the panel for an <img>. */}
        <header className="mb-8">
          <p className="font-jbmono text-[10px] font-bold uppercase tracking-[0.32em] text-pastel-orange-soft">
            Draft Kit {seasonLabel}
          </p>
          <h1 className="mt-3 font-sans text-[2rem] font-black leading-[1.02] tracking-[-0.03em] text-pastel-cream sm:text-[3rem]">
            The board, the cards,
            <br />
            <span className="text-pastel-orange">and the reasoning.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-white/60 sm:text-[15px]">
            Every skater and goalie, ranked and tiered, with percentiles taken inside position and
            never across it. Each card names the database column behind every number on it.
          </p>

          <div
            className="mt-6 flex aspect-[16/7] w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02]"
            role="img"
            aria-label="Draft Kit cover art placeholder"
          >
            <span className="px-4 text-center font-jbmono text-[10px] uppercase tracking-[0.2em] text-white/25">
              Cover art placeholder
              <br />
              founder-supplied
            </span>
          </div>
        </header>

        {loading && (
          <div className="flex items-center gap-2 py-16 text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span className="text-[14px]">Loading the kit</span>
          </div>
        )}

        {!loading && error && (
          <p className="rounded-2xl bg-pastel-surface-tile px-4 py-6 text-center text-[14px] text-white/60 ring-1 ring-white/10">
            {error}
          </p>
        )}

        {!loading && board && (
          <>
            {board.locked && (
              <div
                data-testid="draft-kit-gate-banner"
                className="mb-6 rounded-2xl bg-pastel-orange/10 px-4 py-4 ring-1 ring-pastel-orange/30"
              >
                <p className="text-[14px] font-bold text-pastel-cream">
                  You are on the free tier
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">
                  {board.totalCards} player cards and {board.totalRosterChanges} club changes are in
                  the paid kit. The preview below shows the top five at each position.
                </p>
              </div>
            )}

            {/* Section tabs. Scrollable strip so the row never widens the page. */}
            <nav aria-label="Draft Kit sections" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="flex w-max gap-2">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    aria-pressed={tab === t.id}
                    className={`h-9 shrink-0 rounded-lg px-4 font-jbmono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                      tab === t.id
                        ? 'bg-pastel-orange text-[#581E00]'
                        : 'bg-white/5 text-white/60 ring-1 ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </nav>

            {tab === 'board' && (
              <>
                <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                  <div className="flex w-max gap-2">
                    {COHORTS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCohort(c)}
                        aria-pressed={cohort === c}
                        className={`h-8 shrink-0 rounded-lg px-3 font-jbmono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors ${
                          cohort === c
                            ? 'bg-white/15 text-pastel-cream ring-1 ring-white/25'
                            : 'bg-white/5 text-white/50 ring-1 ring-white/10 hover:bg-white/10'
                        }`}
                      >
                        {COHORT_LABEL[c]}
                        <span className="ml-1.5 text-white/55">{board.cohortSizes[c]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <DraftKitRankings
                    cards={board.cards}
                    cohort={cohort}
                    cohortSize={board.cohortSizes[cohort]}
                    locked={board.locked}
                    onSelect={select}
                    selectedPlayerId={selectedId}
                  />

                  <div className="space-y-4">
                    {selected ? (
                      <DraftKitPlayerCard
                        card={selected}
                        cohortSize={board.cohortSizes[selected.cohort]}
                        metricsSeason={board.metricsSeason}
                        locked={board.locked}
                      />
                    ) : (
                      <p className="rounded-2xl bg-pastel-surface-tile px-4 py-6 text-center text-[13px] text-white/50 ring-1 ring-white/10">
                        Pick a player to open their card.
                      </p>
                    )}

                    {selected && !board.locked && (
                      <BlurbSlot
                        blurbs={playerBlurbs}
                        title={`On ${selected.name}`}
                        emptyLabel="No written note on this player yet."
                      />
                    )}
                  </div>
                </div>
              </>
            )}

            {tab === 'changes' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                <RosterChangeList
                  changes={board.rosterChanges}
                  totalChanges={board.totalRosterChanges}
                  locked={board.locked}
                  onSelect={select}
                />
                <div className="space-y-4">
                  <div className="rounded-2xl bg-pastel-surface-tile p-4 ring-1 ring-white/10">
                    <h3 className="font-jbmono text-[11px] font-bold uppercase tracking-[0.2em] text-pastel-orange-soft">
                      How a move is detected
                    </h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                      A player whose team abbreviation differs between the{' '}
                      {board.projectionSeason - 1} and {board.projectionSeason} player directories is
                      on a new club. The directory records the club and nothing about how the move
                      happened, so this list does not say whether it was a trade or a signing.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {tab === 'reading' && (
              <div className="max-w-2xl">
                <BlurbSlot
                  blurbs={generalBlurbs}
                  title="From the desk"
                  emptyLabel="No written analysis published yet. Pieces from the Citrus desk and the writers we source land here."
                  locked={board.tier !== 'suite'}
                />
              </div>
            )}

            {tab === 'pricing' && <DraftKitPricing currentTier={board.tier} />}
          </>
        )}
      </main>

      <HockeyFooter variant="app" />
    </DarkLayout>
  );
}
