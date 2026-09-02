import { useState } from 'react';
import { cn } from '@/lib/utils';
import { mugInitials, mugTeamAbbrev, teamCrestUrl, type MugPlayer } from './headshot';

/**
 * 28px on a list row, 36px in the sheets' rows, 44px on the Free Agents
 * phone row, 56px in a sheet header.
 *
 * `md` (44px) was added 2026-09-02 for the Free Agents phone list. That row
 * is a DECISION surface — a manager scanning the pool has to recognise a
 * face at a glance, next to a 15px name and a 17px projection — and 28px
 * next to that type reads as a bullet point, not a player. 44 is also the
 * iOS minimum touch target, so the face and the row's tap area agree
 * instead of the face being a decoration inside a bigger hit box.
 *
 * Sizes are NAMED here rather than passed as a className override at the
 * call site: a `w-11 h-11` override would leave `initials` and `crest`
 * sized for the old box, so the fallback states would be wrong at exactly
 * the moment the CDN is failing and nobody is looking.
 */
export type MugSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE: Record<MugSize, { box: string; initials: string; crest: string }> = {
  xs: { box: 'w-7 h-7', initials: 'text-[10px]', crest: 'w-5 h-5' },
  sm: { box: 'w-9 h-9', initials: 'text-[11px]', crest: 'w-6 h-6' },
  md: { box: 'w-11 h-11', initials: 'text-[13px]', crest: 'w-7 h-7' },
  lg: { box: 'w-14 h-14', initials: 'text-lg', crest: 'w-9 h-9' },
};

interface MugProps {
  p: MugPlayer;
  size: MugSize;
  /**
   * Pin a 14px team crest to the bottom-right of the headshot. On for list
   * rows, where the crest used to BE the picture; off in the sheets, whose
   * rows print the team beside the name.
   */
  crest?: boolean;
  /**
   * Which bottom corner the badge sits on. Right by default (the roster
   * row, where the name follows the face); the matchup's opponent card is
   * mirrored, so its badge faces the gutter from the left.
   */
  crestSide?: 'right' | 'left';
  className?: string;
}

/**
 * Headshot with a fallback that still looks designed: headshot → team crest
 * → the player's initials on a forest disc. Real mugs load in production;
 * the fallback carries the row when the CDN doesn't.
 *
 * Its own module (2026-09-01) so the Line Change sheet and the Fill sheet
 * render the same face for the same player — one component, not two that
 * can drift. Extended the same day (audit M4 + R3) to carry every mobile
 * ROW as well: the roster list and both sides of the matchup comparison.
 *
 * Image hygiene, so a list of forty rows never flickers or reflows:
 *   * the box is fixed (`w-7 h-7` etc.) whatever loads inside it;
 *   * `loading="lazy"` + `decoding="async"` on every <img>;
 *   * a failed URL is remembered per URL, not as a boolean, so a fresh
 *     `image` arriving later (enrichment) gets its own try;
 *   * a failed <img> is REPLACED, never left in the DOM — no broken-image
 *     glyph, ever. The crest badge simply disappears if its SVG fails.
 */
export function Mug({ p, size, crest = false, crestSide = 'right', className }: MugProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [failedCrest, setFailedCrest] = useState<string | null>(null);

  const image = p.image || null;
  const abbr = mugTeamAbbrev(p);
  const crestUrl = abbr ? teamCrestUrl(abbr) : null;

  const showImage = image != null && failedImage !== image;
  const crestOk = crestUrl != null && failedCrest !== crestUrl;
  const state = showImage ? 'image' : crestOk ? 'crest' : 'initials';
  const s = SIZE[size];

  return (
    <div className={cn('relative shrink-0', s.box, className)} data-mug-state={state}>
      <div className="w-full h-full rounded-full overflow-hidden bg-pastel-sage/10 ring-1 ring-white/15 flex items-center justify-center">
        {state === 'image' && image ? (
          <img
            src={image}
            alt={p.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
            onError={() => setFailedImage(image)}
          />
        ) : state === 'crest' && crestUrl && abbr ? (
          <img
            src={crestUrl}
            alt={abbr}
            loading="lazy"
            decoding="async"
            className={cn('object-contain', s.crest)}
            onError={() => setFailedCrest(crestUrl)}
          />
        ) : (
          <span
            role="img"
            aria-label={p.name}
            className={cn('font-varsity font-black text-pastel-sage leading-none', s.initials)}
          >
            {mugInitials(p.name)}
          </span>
        )}
      </div>
      {crest && state === 'image' && crestOk && crestUrl && (
        <img
          src={crestUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          data-testid="mug-crest-badge"
          data-side={crestSide}
          className={cn(
            'absolute -bottom-0.5 w-3.5 h-3.5 rounded-full bg-pastel-surface-tile ring-1 ring-pastel-surface-tile object-contain p-px',
            crestSide === 'left' ? '-left-0.5' : '-right-0.5',
          )}
          onError={() => setFailedCrest(crestUrl)}
        />
      )}
    </div>
  );
}

export default Mug;
