/**
 * Loads the theme record and paints it, with the neutral fallback rendered
 * immediately so the suite is never blank while a round trip is in flight.
 */
import { useEffect, useState } from 'react';
import {
  applyGameDayTheme,
  FALLBACK_THEME,
  loadGameDayTheme,
  type GameDayTheme,
} from '@/lib/gameDay/theme';

export function useGameDayTheme(key?: string): { theme: GameDayTheme; loading: boolean } {
  const [theme, setTheme] = useState<GameDayTheme>(FALLBACK_THEME);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Paint the fallback on the first frame. The fetched record replaces it
    // when it lands, and on a dead network it simply stays.
    applyGameDayTheme(FALLBACK_THEME);

    loadGameDayTheme(key)
      .then((loaded) => {
        if (cancelled) return;
        applyGameDayTheme(loaded);
        setTheme(loaded);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { theme, loading };
}
