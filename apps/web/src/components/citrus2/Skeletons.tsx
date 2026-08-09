// Entry 25 U1 — citrus2 skeleton primitives.
//
// Sleeper's perceived speed comes from content-shaped skeletons, not
// generic spinners. Each skeleton mirrors the shape of the content it
// stands in for so the page "settles" instead of "swapping." Shimmer
// via CSS gradient (citrus-shimmer keyframe in tailwind.config.ts),
// tokens-only surface, dark-theme native. The global reduced-motion
// override in index.css:1773 disables the shimmer for users who ask.

const SHIMMER_BASE = [
  'relative overflow-hidden rounded-md',
  'bg-white/5',
  'bg-gradient-to-r from-white/5 via-white/10 to-white/5',
  'bg-[length:200%_100%]',
  'animate-citrus-shimmer',
].join(' ');

/**
 * SkeletonBlock — atomic building block. Prefer the higher-level
 * primitives (SkeletonCard, SkeletonRow, SkeletonStatTile) — use
 * SkeletonBlock only for one-off custom layouts.
 */
export function SkeletonBlock({
  className = '',
  ariaHidden = true,
}: {
  className?: string;
  ariaHidden?: boolean;
}) {
  return (
    <div
      className={`${SHIMMER_BASE} ${className}`}
      aria-hidden={ariaHidden ? 'true' : undefined}
      data-testid="skeleton-block"
    />
  );
}

/**
 * SkeletonCard — the shape of a citrus2 Card. Titled section with
 * a header line, body lines, and a footer accent. Renders on the
 * dark-forest surface via bg-[#1A2A20].
 */
export function SkeletonCard({
  lines = 3,
  className = '',
  showFooter = true,
}: {
  lines?: number;
  className?: string;
  showFooter?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-[#1A2A20] ring-1 ring-white/5 p-6 ${className}`}
      role="status"
      aria-label="Loading content"
      data-testid="skeleton-card"
    >
      <SkeletonBlock className="h-3 w-24 mb-3" />
      <SkeletonBlock className="h-6 w-3/5 mb-5" />
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonBlock
            key={i}
            className={`h-3 ${i === lines - 1 ? 'w-4/5' : 'w-full'}`}
          />
        ))}
      </div>
      {showFooter && <SkeletonBlock className="h-2 w-16 mt-6" />}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * SkeletonRow — the shape of a single table/list row. Avatar + name
 * + secondary label + value column. Use in lists (roster, standings,
 * managers panel).
 */
export function SkeletonRow({
  showAvatar = true,
  className = '',
}: {
  showAvatar?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 py-3 ${className}`}
      role="status"
      aria-label="Loading row"
      data-testid="skeleton-row"
    >
      {showAvatar && <SkeletonBlock className="h-9 w-9 rounded-full flex-shrink-0" />}
      <div className="flex-1 min-w-0 space-y-1.5">
        <SkeletonBlock className="h-3.5 w-1/3" />
        <SkeletonBlock className="h-2.5 w-1/5" />
      </div>
      <SkeletonBlock className="h-4 w-12 flex-shrink-0" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * SkeletonStatTile — the shape of a KPI / stat card. Label above,
 * big number below, tiny trend under. Use in stats overviews and
 * matchup headers.
 */
export function SkeletonStatTile({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-[#1A2A20] ring-1 ring-white/5 p-5 ${className}`}
      role="status"
      aria-label="Loading stat"
      data-testid="skeleton-stat-tile"
    >
      <SkeletonBlock className="h-2.5 w-16 mb-3" />
      <SkeletonBlock className="h-9 w-24 mb-2" />
      <SkeletonBlock className="h-2 w-20" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
