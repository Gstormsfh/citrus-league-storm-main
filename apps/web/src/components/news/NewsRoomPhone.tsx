/**
 * THE CITRUS NEWS ROOM ON A PHONE (2026-09-05).
 *
 * Garrett, 2026-09-05: "we have access to ESPN, NHL, etc there will be
 * articles and things written about our players and it should come through
 * like sleeper and Yahoo do where it summarizes and links the source."
 *
 * So: a feed of wire stories the server has already read, matched to the
 * players they name and summarised in one sentence. Two views in a
 * segmented control: MY PLAYERS (stories that name someone on the roster of
 * the league in the header) and ALL. Under it a chip per team with a story
 * today, busiest first. Stories are grouped by day and stacked in one tile
 * per day, the way a feed reads: the eye keeps the day, the thumb keeps
 * scrolling. Every row is the link to the writer; we never byline a wire
 * story as ours.
 *
 * The section head carries the freshness line ("Read 12m ago · 7 sources"):
 * an affirmative signal that the wires are being read, because silence and
 * a dead ingest look identical without one.
 */
import { useEffect, useRef } from 'react';
import { Search, Newspaper } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PressBoxSegmented } from '@/components/pressbox/Segmented';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxSkeletonCard } from '@/components/pressbox/Skeleton';
import type { WireHealth, WireNewsItem } from '@/services/NewsRoomService';
import { NewsItemRow } from './NewsItemRow';
import { filterQuery, filterTeam, freshnessLine, groupByDay, namesFor, teamChips, type NewsSegment } from './newsRoomRows';

export interface NewsRoomPhoneProps {
  /** The segment's stories, newest first; the host fetches per segment. */
  items: WireNewsItem[];
  loading: boolean;
  health: WireHealth | null;
  segment: NewsSegment;
  onSegment: (segment: NewsSegment) => void;
  /** False when the viewer holds no roster in the active league: MY PLAYERS then explains itself. */
  hasRoster: boolean;
  team: string;
  onTeam: (team: string) => void;
  searchOpen: boolean;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  /** Resolves an NHL player id to a display name; undefined when unknown. */
  nameOf: (id: number) => string | undefined;
  className?: string;
}

const SEGMENTS = [
  { key: 'mine', label: 'MY PLAYERS' },
  { key: 'all', label: 'ALL' },
];

export function NewsRoomPhone({
  items,
  loading,
  health,
  segment,
  onSegment,
  hasRoster,
  team,
  onTeam,
  searchOpen,
  searchQuery,
  onSearchQuery,
  nameOf,
  className,
}: NewsRoomPhoneProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const chips = teamChips(items);
  const visible = filterQuery(filterTeam(items, team), searchQuery);
  const sections = groupByDay(visible);
  const freshness = freshnessLine(health);

  return (
    <div data-testid="news-room" className={cn(PB_TYPE, 'px-3.5', className)}>
      {searchOpen && (
        <div className="mb-2.5 flex items-center gap-2 h-[38px] px-3 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
          <Search className="w-[15px] h-[15px] text-pressbox-text/45" strokeWidth={2} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            placeholder="Search the wire…"
            aria-label="Search news"
            data-testid="news-room-search"
            className="flex-1 min-w-0 bg-transparent font-barlow text-[16px] text-pressbox-text placeholder:text-pressbox-text/45 outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQuery('')}
              className="focus-citrus font-plex font-semibold text-[9px] tracking-[0.08em] text-pressbox-text/55 uppercase"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <PressBoxSegmented
          segments={SEGMENTS}
          activeKey={segment}
          onSelect={(k) => onSegment(k as NewsSegment)}
          label="News Room view"
        />
        {freshness && (
          <span data-testid="news-room-freshness" className="font-plex text-[9px] tracking-[0.08em] uppercase text-pressbox-text/45 truncate">
            {freshness}
          </span>
        )}
      </div>

      {chips.length > 1 && (
        <div className="mt-2.5 -mx-3.5 py-2.5 -my-2.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <PressBoxChips chips={chips} activeKey={team} onSelect={onTeam} label="Team filter" outlined compact className="w-max px-3.5" />
        </div>
      )}

      <PressBoxSectionHead
        className="mt-3.5"
        title={searchQuery ? 'Results' : segment === 'mine' ? 'Your players' : 'On the wire'}
        count={!loading && visible.length > 0 ? String(visible.length) : null}
      />

      {loading ? (
        <div className="mt-2.5 flex flex-col gap-2" data-testid="news-room-loading" role="status" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <PressBoxSkeletonCard key={i} height={96} lines={3} index={i} />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <EmptyWire segment={segment} hasRoster={hasRoster} searchQuery={searchQuery} team={team} onAll={() => onSegment('all')} />
      ) : (
        <div className="mt-2.5 flex flex-col gap-3" data-testid="news-room-list">
          {sections.map((section) => (
            <section key={section.key} aria-label={section.label}>
              <h3 className="px-0.5 mb-1.5 font-plex font-semibold text-[9px] tracking-[0.12em] uppercase text-pressbox-text/45">{section.label}</h3>
              <ul className="rounded-[12px] bg-pressbox-tile border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <NewsItemRow item={item} playerNames={namesFor(item, nameOf)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyWire({
  segment,
  hasRoster,
  searchQuery,
  team,
  onAll,
}: {
  segment: NewsSegment;
  hasRoster: boolean;
  searchQuery: string;
  team: string;
  onAll: () => void;
}) {
  let title = 'Nothing on the wire';
  let body = 'The beat picks up around puck drop. Check back then.';
  let showAll = false;
  if (searchQuery) {
    title = 'Nothing matched';
    body = `No stories matched “${searchQuery}”.`;
  } else if (team !== 'all') {
    title = `Quiet in ${team}`;
    body = 'No story on the wire today names that team.';
  } else if (segment === 'mine' && !hasRoster) {
    title = 'No roster yet';
    body = 'Once you draft, every story that names one of your players lands here.';
    showAll = true;
  } else if (segment === 'mine') {
    title = 'Quiet on your guys';
    body = 'Nothing on the wire names a player you hold yet.';
    showAll = true;
  }
  return (
    <div className="mt-2.5 px-4 py-10 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="news-room-empty">
      <Newspaper className="w-6 h-6 mx-auto text-pressbox-text/40" aria-hidden="true" />
      <p className="mt-3 font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">{title}</p>
      <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">{body}</p>
      {showAll && (
        <button
          type="button"
          onClick={onAll}
          className="focus-citrus mt-4 inline-flex h-[34px] items-center px-4 rounded-[10px] bg-pressbox-orange text-pressbox-orange-ink font-plex font-bold text-[10px] tracking-[0.1em] uppercase"
        >
          See everything on the wire
        </button>
      )}
    </div>
  );
}

export default NewsRoomPhone;
