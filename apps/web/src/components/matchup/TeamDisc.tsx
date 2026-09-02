import { useState } from 'react';
import { cn } from '@/lib/utils';
import { initialOf } from './scoreboard';

/**
 * TEAM DISC (2026-09-01, Sleeper parity audit M8).
 *
 * The round badge that stands for a fantasy team everywhere the matchup
 * page names one: the sticky score bar, the ScoreCard (phone and desktop)
 * and the league scoreboard chips. Sleeper's header carries the manager's
 * avatar on each side; Citrus teams have no picture of their own yet, so
 * the disc shows the OWNER's profile picture (`profiles.avatar_url`, joined
 * into the league/teams response) and falls back to the team's initial —
 * the letter every disc showed before this.
 *
 * One component, not three private copies, so the fallback behaves the
 * same in every spot: a URL that fails to load is remembered per URL and
 * REPLACED by the initial, never left as a broken-image glyph; a fresh URL
 * (a manager who just uploaded one) gets its own try. The image is
 * decorative — the team name always sits beside the disc — so it carries an
 * empty alt.
 *
 * Colour follows the identity ≠ standing rule (ScoreCard.test.tsx):
 * orange shell = YOU, muted shell = everyone else. Never sage, which means
 * "ahead" on this page.
 */

export type TeamDiscSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE: Record<TeamDiscSize, { box: string; initial: string; ownRing: string }> = {
  /** 20px — scoreboard chips. */
  xs: { box: 'w-5 h-5', initial: 'text-[9px]', ownRing: 'ring-1 ring-pastel-orange/50' },
  /** 24px — the sticky score bar (56px band, two text lines beside it). */
  sm: { box: 'w-6 h-6', initial: 'text-[10px]', ownRing: 'ring-2 ring-pastel-orange/50' },
  /** 32px — the ScoreCard on a phone. */
  md: { box: 'w-8 h-8', initial: 'text-xs', ownRing: 'ring-2 ring-pastel-orange/50' },
  /** 48px — the ScoreCard on desktop. */
  lg: { box: 'w-12 h-12 shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]', initial: 'text-xl', ownRing: 'ring-2 ring-pastel-orange/50' },
};

export interface TeamDiscProps {
  /** Team name — its first letter is the fallback. */
  name: string;
  /** Owner's profile picture, when the league/teams response carries one. */
  avatarUrl?: string | null;
  /** The viewer's own team: orange identity shell. */
  own?: boolean;
  size: TeamDiscSize;
  className?: string;
}

export function TeamDisc({ name, avatarUrl, own = false, size, className }: TeamDiscProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = avatarUrl && avatarUrl.trim() ? avatarUrl : null;
  const showImage = url !== null && failedUrl !== url;
  const s = SIZE[size];

  return (
    <span
      data-testid="team-disc"
      data-disc-state={showImage ? 'image' : 'initials'}
      aria-hidden="true"
      className={cn(
        'rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center',
        s.box,
        own ? `bg-pastel-orange/20 text-pastel-orange-soft ${s.ownRing}` : 'bg-white/5 ring-1 ring-white/15 text-pastel-cream',
        className,
      )}
    >
      {showImage && url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span className={cn('font-varsity leading-none', s.initial)}>{initialOf(name)}</span>
      )}
    </span>
  );
}

export default TeamDisc;
