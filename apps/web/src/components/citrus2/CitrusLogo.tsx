/**
 * Citrus brand mark — fruit + puck hybrid SVG.
 *
 * The brand wordmark uses font-calistoga "Citrus" + the orange dot indicator
 * we already established. This component is the standalone GLYPH version for
 * places that need a logomark without text (favicons, app icons, footer
 * accents, mascot card watermarks, loading states).
 *
 * Geometry: a puck silhouette with the orange citrus segment lines visible
 * inside — it reads as both fruit (the segments) and puck (the disc shape).
 * License-clean, generic, distinctly Citrus.
 */
export function CitrusLogo({
  className = 'w-8 h-8',
  variant = 'on-dark',
}: {
  className?: string;
  variant?: 'on-dark' | 'on-light' | 'mono';
}) {
  const orange = '#FF6B1A';
  const sage = '#84A57D';
  const cream = '#FFF8F0';
  const forest = '#0F1F15';

  const fill = variant === 'on-dark' ? cream : variant === 'mono' ? 'currentColor' : forest;
  const accent = variant === 'mono' ? 'currentColor' : orange;
  const segmentStroke = variant === 'mono' ? 'currentColor' : sage;

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Puck disc */}
      <circle cx="32" cy="32" r="28" fill={accent} />
      {/* Inner cream face — the citrus flesh */}
      <circle cx="32" cy="32" r="22" fill={fill} />
      {/* Citrus segment lines radiating from center */}
      <line x1="32" y1="10" x2="32" y2="54" stroke={segmentStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="10" y1="32" x2="54" y2="32" stroke={segmentStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="16.4" y1="16.4" x2="47.6" y2="47.6" stroke={segmentStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="47.6" y1="16.4" x2="16.4" y2="47.6" stroke={segmentStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* Center pith */}
      <circle cx="32" cy="32" r="3" fill={accent} />
      {/* Puck edge ridge highlight */}
      <ellipse cx="32" cy="32" rx="28" ry="28" fill="none" stroke={accent} strokeWidth="2" opacity="0.4" />
    </svg>
  );
}

/**
 * Citrus wordmark — "Citrus" in Calistoga + orange dot indicator.
 * The logotype version we use throughout the app chrome.
 */
export function CitrusWordmark({
  className = '',
  size = 'md',
  showDot = true,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showDot?: boolean;
}) {
  const sz = size === 'xl' ? 'text-[32px]' : size === 'lg' ? 'text-[26px]' : size === 'md' ? 'text-[22px]' : 'text-[18px]';
  const dot = size === 'xl' ? 'w-2 h-2' : size === 'lg' ? 'w-1.5 h-1.5' : 'w-1.5 h-1.5';
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`font-calistoga leading-none text-pastel-cream ${sz}`}>Citrus</span>
      {showDot && <span aria-hidden="true" className={`block bg-pastel-orange rounded-full animate-pulse ${dot}`} />}
    </span>
  );
}
