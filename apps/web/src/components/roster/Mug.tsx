import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { HockeyPlayer } from './HockeyPlayerCard';

/**
 * Headshot with a fallback that still looks designed: the player's initials
 * on a forest disc. Real mugs load in production; the fallback carries the
 * row when the CDN doesn't.
 *
 * Its own module (2026-09-01) so the Line Change sheet and the Fill sheet
 * render the same face for the same player — one component, not two that
 * can drift.
 */
export function Mug({ p, size }: { p: HockeyPlayer; size: 'sm' | 'lg' }) {
  const [err, setErr] = useState(false);
  const initials = p.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  const cls = size === 'lg' ? 'w-14 h-14' : 'w-9 h-9';
  return (
    <div
      className={cn(
        cls,
        'shrink-0 rounded-full overflow-hidden bg-pastel-sage/10 ring-1 ring-white/15 flex items-center justify-center',
      )}
    >
      {p.image && !err ? (
        <img
          src={p.image}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setErr(true)}
        />
      ) : (
        <span
          className={cn(
            'font-varsity font-black text-pastel-sage',
            size === 'lg' ? 'text-lg' : 'text-[11px]',
          )}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

export default Mug;
