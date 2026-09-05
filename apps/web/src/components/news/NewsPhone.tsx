/**
 * THE NEWS TAB ON A PHONE (2026-09-04).
 *
 * No artboard draws it, so it is built from the ones that exist: the app
 * header with the tab's name, the Players screen's search row and chip
 * row, and a list of tiles. The first story is the lead — its picture
 * across the tile, the category and the time in Plex over a 16px Barlow
 * headline — and every story after it is a row: a 64px thumbnail, the
 * same eyebrow, a two-line headline, the source. A feed is read top to
 * bottom with the thumb, and a row a thumb can cover in one glance is the
 * unit; the old grid of picture cards was the desktop's, three across,
 * folded to one column.
 *
 * Categories are chips (the artboard's filter), scrolling, the active
 * one in cream. Category colour is gone: one filter, chosen, needs no
 * palette to be read.
 */
import { useEffect, useRef } from 'react';
import { Search, Newspaper } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxSkeletonCard } from '@/components/pressbox/Skeleton';
import type { NewsArticle } from '@/services/NewsService';
import { agoLabel } from './newsFormat';

export interface NewsPhoneProps {
  articles: NewsArticle[];
  loading: boolean;
  categories: ReadonlyArray<{ key: string; label: string }>;
  category: string;
  onCategory: (key: string) => void;
  searchOpen: boolean;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  className?: string;
}

/** A thumbnail that could not load leaves no hole: the img hides itself. */
const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = 'none';
};

const CATEGORY_LABEL: Record<string, string> = {
  top: 'TOP',
  fantasy: 'FANTASY',
  trade: 'TRADE',
  injury: 'INJURY',
  recap: 'RECAP',
  olympics: 'OLYMPICS',
};

function Eyebrow({ article }: { article: NewsArticle }) {
  return (
    <p className="font-plex font-semibold text-[9px] tracking-[0.1em] text-pressbox-text/45 truncate">
      <span className={cn(article.category === 'injury' ? 'text-pressbox-grapefruit-text' : 'text-pressbox-orange-soft')}>
        {CATEGORY_LABEL[article.category] ?? article.category.toUpperCase()}
      </span>
      {' · '}
      {agoLabel(article.publishedAt)}
    </p>
  );
}

export function NewsPhone({
  articles,
  loading,
  categories,
  category,
  onCategory,
  searchOpen,
  searchQuery,
  onSearchQuery,
  className,
}: NewsPhoneProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const [lead, ...rest] = articles;

  return (
    <div data-testid="news-phone" className={cn(PB_TYPE, 'px-3.5', className)}>
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
            data-testid="news-phone-search"
            className="flex-1 min-w-0 bg-transparent font-barlow text-[14px] text-pressbox-text placeholder:text-pressbox-text/45 outline-none"
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

      <div className="-mx-3.5 py-2.5 -my-2.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PressBoxChips
          chips={categories.map((c) => ({ key: c.key, label: c.label.toUpperCase() }))}
          activeKey={category}
          onSelect={onCategory}
          label="News category"
          outlined
          compact
          className="w-max px-3.5"
        />
      </div>

      <PressBoxSectionHead
        className="mt-3.5"
        title={searchQuery ? 'Results' : 'On the wire'}
        count={!loading && articles.length > 0 ? String(articles.length) : null}
      />

      {loading ? (
        <div className="mt-2.5 flex flex-col gap-2" data-testid="news-phone-loading" role="status" aria-label="Loading">
          <PressBoxSkeletonCard height={220} lines={3} className="justify-end" />
          {[1, 2, 3].map((i) => (
            <PressBoxSkeletonCard key={i} height={84} index={i} />
          ))}
        </div>
      ) : !lead ? (
        <div className="mt-2.5 px-4 py-10 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="news-phone-empty">
          <Newspaper className="w-6 h-6 mx-auto text-pressbox-text/40" aria-hidden="true" />
          <p className="mt-3 font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">
            {searchQuery ? 'Nothing matched' : 'Nothing on the wire'}
          </p>
          <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">
            {searchQuery
              ? `No stories matched “${searchQuery}”.`
              : 'The beat picks up around puck drop. Check back then.'}
          </p>
        </div>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2" data-testid="news-phone-list">
          <li>
            <a
              href={lead.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="news-phone-lead"
              className="focus-citrus block rounded-[12px] bg-pressbox-tile border border-white/[0.08] overflow-hidden"
            >
              {lead.imageUrl ? (
                <img src={lead.imageUrl} alt="" className="w-full h-[170px] object-cover" loading="eager" onError={hideOnError} />
              ) : (
                <div className="w-full h-[96px] bg-white/[0.03] flex items-center justify-center">
                  <Newspaper className="w-7 h-7 text-pressbox-text/30" aria-hidden="true" />
                </div>
              )}
              <div className="px-3 pt-2.5 pb-3">
                <Eyebrow article={lead} />
                <h3 className="mt-1 font-barlow font-bold text-[16px] leading-[1.25] text-pressbox-text">{lead.title}</h3>
                {lead.description && (
                  <p className="mt-1 font-barlow text-[12px] leading-[1.4] text-pressbox-text/60 line-clamp-2">{lead.description}</p>
                )}
                <p className="mt-1.5 font-plex font-medium text-[9px] tracking-[0.08em] text-pressbox-sage uppercase truncate">
                  {lead.source}
                </p>
              </div>
            </a>
          </li>
          {rest.map((a) => (
            <li key={a.id}>
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-citrus flex items-stretch gap-3 p-2.5 rounded-[12px] bg-pressbox-tile border border-white/[0.08]"
              >
                {a.imageUrl ? (
                  <img src={a.imageUrl} alt="" className="w-16 h-16 flex-none rounded-[8px] object-cover" loading="lazy" onError={hideOnError} />
                ) : (
                  <div className="w-16 h-16 flex-none rounded-[8px] bg-white/[0.04] flex items-center justify-center">
                    <Newspaper className="w-5 h-5 text-pressbox-text/30" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1 flex flex-col justify-center">
                  <Eyebrow article={a} />
                  <h3 className="mt-0.5 font-barlow font-semibold text-[13px] leading-[1.3] text-pressbox-text line-clamp-2">{a.title}</h3>
                  <p className="mt-1 font-plex font-medium text-[9px] tracking-[0.08em] text-pressbox-text/45 uppercase truncate">{a.source}</p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default NewsPhone;
