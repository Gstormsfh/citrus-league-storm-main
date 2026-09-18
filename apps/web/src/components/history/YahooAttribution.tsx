/**
 * Yahoo's attribution, exactly as the API Access and Use Agreement asks for
 * it (signed 2026-09-17): "Fantasy data provided by Yahoo Fantasy", as a
 * link to an official Yahoo Fantasy page, in the footer of every web page
 * that shows Yahoo data and in the app's Legal section. One component so the
 * words and the link never drift between the places it appears.
 */
import { interceptExternal } from '@/lib/openExternal';

export const YAHOO_FANTASY_URL = 'https://sports.yahoo.com/fantasy/';
export const YAHOO_ATTRIBUTION = 'Fantasy data provided by Yahoo Fantasy';

export function YahooAttribution({ className = '' }: { className?: string }) {
  return (
    <p className={`font-barlow text-[12px] text-white/55 ${className}`} data-testid="yahoo-attribution">
      Fantasy data provided by{' '}
      <a
        href={YAHOO_FANTASY_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => { if (interceptExternal(YAHOO_FANTASY_URL)) e.preventDefault(); }}
        className="underline decoration-white/30 underline-offset-2 hover:text-pressbox-text"
      >
        Yahoo Fantasy
      </a>
    </p>
  );
}
