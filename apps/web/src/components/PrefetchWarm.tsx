/**
 * WARM THE BIG READ (2026-09-09, feedback item #22, "every screen loads").
 *
 * The player pool is the largest response in the app and the first thing
 * Roster, Free Agents, Players and the draft all wait on. Each page fetched
 * it on its own mount, so the first tap into any of them paid the full
 * download before painting. This asks for it once, shortly after sign-in,
 * while the first screen is already on the glass; PlayerService keeps it in
 * memory for five minutes and shares one in-flight request, so a page that
 * mounts mid-download joins it instead of starting another.
 *
 * Deliberately not on the draft room: the room has its own, heavier loads
 * and should not compete with a warm-up it does not need.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PlayerService } from '@/services/PlayerService';

const DELAY_MS = 1200;

export function isDraftPath(pathname: string): boolean {
  return /^\/(draft|draft-v2|draft-room)(\/|$)/.test(pathname);
}

export default function PrefetchWarm() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!user || firedRef.current || isDraftPath(pathname)) return;
    const handle = window.setTimeout(() => {
      firedRef.current = true;
      void PlayerService.getAllPlayers().catch(() => {
        /* best effort: the page that needs it will ask again */
      });
    }, DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [user, pathname]);

  return null;
}
