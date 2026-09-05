/**
 * THE ROUTE FALLBACK (PR3, 2026-09-04).
 *
 * Two jobs, one component. `App.tsx` mounts it as the Suspense fallback
 * while a route's chunk is fetched -- the first visit to each tab -- and the
 * v1 draft room mounts it as a full-screen overlay with a message while it
 * checks auth. Both used to be the same thing: a spinner over a fixed
 * `pastel-surface` sheet that also covered the app nav, so tapping PLAYERS
 * blanked the nav you had just tapped.
 *
 * Below `lg`, with no message, it is now the skeleton of the screen the URL
 * names -- roster rows for /roster, the standings table for /standings, the
 * lead tile and rows for the app tabs -- in the page column, under the nav,
 * so the tab stays lit and the page settles into rows that were already
 * there. There is no chrome above it: the fallback renders outside
 * `<Routes>`, where `useParams()` is empty, and a header that named the
 * context's league over a `/league/:id` chunk for another one would be
 * wrong for the 200ms it showed. A header-shaped shimmer holds the space.
 *
 * With a message, or from `lg`, it is the overlay it was, on Press Box
 * paint. The eight-second valve and the tap-to-dismiss survive there only:
 * a skeleton that stays is the honest state of a chunk that has not
 * arrived, and `lazyWithErrorHandling` owns the failure.
 */
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxSkeletonBar, PressBoxSkeletonScreen } from '@/components/pressbox/Skeleton';
import { routeSkeleton } from '@/lib/routeSkeleton';

interface LoadingScreenProps {
  message?: string;
  className?: string;
}

/** The league header's silhouette: crest, name, four tabs. */
function LeagueChromeSilhouette() {
  return (
    <div aria-hidden="true" className="pt-[env(safe-area-inset-top)]" data-testid="pb-skeleton-league-chrome">
      <div className="flex items-center gap-2.5 px-4 pt-2.5 pb-2">
        <span className="w-[30px] h-[30px] rounded-[8px] pb-shimmer flex-none" />
        <PressBoxSkeletonBar className="h-[15px] w-[140px]" />
      </div>
      <div className="grid grid-cols-4 px-4 pb-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="flex justify-center py-2">
            <PressBoxSkeletonBar className="h-[10px] w-[44px]" style={{ animationDelay: `${i * 120}ms` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** The app header's silhouette: a 24px condensed title and two squares. */
function AppChromeSilhouette() {
  return (
    <div aria-hidden="true" className="pt-[env(safe-area-inset-top)]" data-testid="pb-skeleton-app-chrome">
      <div className="flex items-center justify-between pl-4 pr-4 pt-2 pb-1.5">
        <PressBoxSkeletonBar className="h-[22px] w-[110px]" />
        <div className="flex gap-1.5">
          <span className="w-[34px] h-[34px] rounded-[10px] pb-shimmer" />
          <span className="w-[34px] h-[34px] rounded-[10px] pb-shimmer" style={{ animationDelay: '120ms' }} />
        </div>
      </div>
    </div>
  );
}

function RouteSkeleton({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const shape = routeSkeleton(pathname);
  return (
    <div
      className={cn(PB_TYPE, 'min-h-screen bg-pressbox-surface text-pressbox-text', className)}
      role="status"
      aria-label="Loading"
      aria-busy="true"
      data-testid="route-skeleton"
      data-kind={shape.kind}
    >
      {shape.chrome === 'league' && <LeagueChromeSilhouette />}
      {shape.chrome === 'app' && <AppChromeSilhouette />}
      <PressBoxSkeletonScreen kind={shape.kind} />
    </div>
  );
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message, className }) => {
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useState(false);
  const [showTapHint, setShowTapHint] = useState(false);

  // Auto-dismiss after 8 seconds as a safety valve
  useEffect(() => {
    const hintTimer = setTimeout(() => setShowTapHint(true), 4000);
    const dismissTimer = setTimeout(() => setDismissed(true), 8000);
    return () => {
      clearTimeout(hintTimer);
      clearTimeout(dismissTimer);
    };
  }, []);

  if (isMobile && !message) return <RouteSkeleton className={className} />;

  if (dismissed) return null;

  return (
    <div
      className={cn(
        PB_TYPE,
        'fixed inset-0 z-app-nav flex items-center justify-center cursor-pointer',
        'bg-pressbox-surface text-pressbox-text',
        className,
      )}
      onClick={() => setDismissed(true)}
      role="status"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-pressbox-orange animate-spin" />
        <p className="font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/55">{message ?? 'Loading…'}</p>
        {showTapHint && (
          <p className="font-barlow text-[12px] text-pressbox-text/45 animate-pulse">Tap anywhere to continue</p>
        )}
      </div>
    </div>
  );
};

export default LoadingScreen;
