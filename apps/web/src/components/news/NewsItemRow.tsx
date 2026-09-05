/**
 * ONE WIRE STORY (NEWS ROOM, 2026-09-05). The shape Sleeper and Yahoo use
 * for a player's news: a source chip and the time, the headline, one plain
 * sentence, and the link to the writer. We show what a link preview shows.
 * The whole row is the link; on the phone it opens in the system browser
 * through openExternal so the app is not left behind.
 */
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { interceptExternal } from '@/lib/openExternal';
import type { WireNewsItem } from '@/services/NewsRoomService';
import { sourceLabel, timeAgo } from './newsRoomRows';

export interface NewsItemRowProps {
  item: WireNewsItem;
  /** Names of the players the row should call out, already resolved by the host. */
  playerNames?: string[];
  className?: string;
}

export function NewsItemRow({ item, playerNames = [], className }: NewsItemRowProps) {
  const summary = item.summary || item.snippet || '';
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (interceptExternal(item.url)) e.preventDefault();
      }}
      className={cn(PB_TYPE, 'focus-citrus block px-3.5 py-3 active:bg-white/5', className)}
      data-testid="news-item"
    >
      <div className="flex items-center gap-2 font-plex font-semibold text-[9px] tracking-[0.12em] uppercase">
        <span className="px-1.5 py-0.5 rounded-[4px] bg-white/10 text-pressbox-text/80">{sourceLabel(item.source_id)}</span>
        {item.team_abbrev && <span className="text-pressbox-text/45">{item.team_abbrev}</span>}
        <span className="ml-auto text-pressbox-text/45 tabular-nums">{timeAgo(item.published_at)}</span>
      </div>
      <div className="mt-1.5 font-barlow font-bold text-[15px] leading-snug text-pressbox-text">{item.title}</div>
      {summary && summary !== item.title && (
        <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-pressbox-text/70">{summary}</p>
      )}
      <div className="mt-1.5 flex items-center gap-2 font-plex font-medium text-[9px] tracking-[0.08em] uppercase text-pressbox-text/45">
        {playerNames.length > 0 && <span className="text-pressbox-orange-soft truncate">{playerNames.slice(0, 3).join(' · ')}</span>}
        <span className="ml-auto whitespace-nowrap">{item.author ? `${item.author} · ` : ''}Read at {sourceLabel(item.source_id)} ›</span>
      </div>
    </a>
  );
}

export default NewsItemRow;
