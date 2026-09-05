/**
 * THE PAGE'S LOADING BRANCH, BOTH LAYERS (PR3, motion board 2b, 2026-09-04).
 *
 * Five league pages returned early while their data loaded -- a full-screen
 * Stormy on a `#0F1F15` ground, no header, no tabs, no nav context -- and
 * then the whole screen swapped in at once. The board asks for the
 * opposite: the chrome stays, and the body arrives as a skeleton that IS the
 * screen with the words missing, so the data settles into rows that were
 * already there.
 *
 * Below `lg` this renders the league chrome (header, sub-tabs, the menu)
 * over the kind's skeleton. From `lg` it renders exactly what the pages
 * rendered before -- Stormy, centred -- so the desktop is untouched and the
 * page tests, which see a 1024px window, still find "Loading the standings…".
 *
 * `useIsMobile()` rather than two Tailwind branches: the skeleton runs
 * sixteen staggered shimmers and Stormy runs a ping and a float, and a
 * hidden branch still animates. One of them mounts, never both.
 *
 * Not on the barrel: `PressBoxLeagueChrome` reads LeagueContext, and the
 * barrel stays context-free so the presentational tests can import it.
 */
import { StormyLoading } from '@/components/citrus2/StormyLoading';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { PB_TYPE } from './rowScale';
import { PressBoxLeagueChrome, type PressBoxLeagueChromeProps } from './LeagueChrome';
import { PressBoxSkeletonScreen, type PressBoxSkeletonKind } from './Skeleton';

export interface PressBoxPageLoadingProps {
  kind: PressBoxSkeletonKind;
  /** The desktop's Stormy line, unchanged from before. */
  message: string;
  /**
   * The league chrome above the skeleton. `false` for a page that has no
   * league yet (the chrome would draw a `?` crest over an empty name).
   */
  chrome?: boolean | PressBoxLeagueChromeProps;
  className?: string;
}

export function PressBoxPageLoading({ kind, message, chrome = true, className }: PressBoxPageLoadingProps) {
  const isMobile = useIsMobile();
  if (!isMobile) {
    return (
      <div className={cn('min-h-screen flex items-center justify-center bg-[#0F1F15]', className)}>
        <StormyLoading message={message} />
      </div>
    );
  }
  return (
    <div
      className={cn(PB_TYPE, 'min-h-screen bg-pressbox-surface text-pressbox-text', className)}
      data-testid="pb-page-loading"
      aria-busy="true"
    >
      {chrome !== false && <PressBoxLeagueChrome {...(chrome === true ? {} : chrome)} />}
      <PressBoxSkeletonScreen kind={kind} />
      <span className="sr-only">{message}</span>
    </div>
  );
}

export default PressBoxPageLoading;
