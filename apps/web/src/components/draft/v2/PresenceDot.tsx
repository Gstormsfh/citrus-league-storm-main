// Phase 4.5 chunk 11g.5b — PresenceDot primitive.
//
// Small visual indicator: green dot if `userId` is in
// `presentUserIds`, gray dot otherwise. Used wherever team rows /
// avatars are rendered so users can see who's connected at a
// glance.
//
// Multi-device dedup is server-side (chunk 11g.4 step 5's
// `presentUserIds` Set is already deduped); this component just
// renders the union state.

import { usePresence } from '@/stores/draftClientStore';
import { cn } from '@/lib/utils';

interface PresenceDotProps {
  userId: string;
  /** Optional className passthrough for layout / sizing overrides. */
  className?: string;
}

export function PresenceDot({ userId, className }: PresenceDotProps) {
  const presentUserIds = usePresence();
  const isOnline = presentUserIds.has(userId);

  return (
    <span
      role="status"
      aria-label={isOnline ? `${userId} is online` : `${userId} is offline`}
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        isOnline ? 'bg-green-500' : 'bg-gray-400',
        className,
      )}
    />
  );
}
