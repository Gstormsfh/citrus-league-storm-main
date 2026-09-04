import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';
import { Homepage } from '@/components/citrus2';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSeasonStatus } from '@/hooks/useSeasonStatus';
import { PressBoxHome } from '@/components/home/PressBoxHome';

/**
 * Production homepage. Renders the Citrus 2.0 Homepage composition (dark
 * forest, hockey-first, Citrus Squad mascots) — the storefront — for the
 * web, and for anyone signed out or without a league.
 *
 * THE APP HOME (PRESS BOX, 2026-09-04). A signed-in manager with a league,
 * on a phone or in the native app, gets artboard 1a's LEAGUES tab here
 * instead: tonight's slate, every league they are in with its live line,
 * their players playing tonight. This supersedes the NATIVE BOOT DESTINATION
 * of 2026-08-31, which sent the native app straight to League HQ because
 * this route had "no app navigation at all" — the sales pitch, reported
 * from the simulator as "there are no menus." The app home has the app
 * nav, the Stormy bar and the league cards; League HQ is one tap on the
 * card, and it is where a manager with ONE league still lands in a second
 * tap rather than a redirect, because the LEAGUES tab has to be able to
 * come back here — a tab that redirects away from itself is not a tab.
 *
 * The loading hold matters: auth and league context resolve asynchronously
 * on cold start. Deciding before they settle would flash the marketing page
 * at every boot (or worse, strand a signed-in user there because `user` was
 * still null when we looked). While they settle we paint the splash ground
 * color and nothing else — on native, where the flash would be the app's
 * first frame.
 */
const Index = () => {
  const auth = useAuth();
  const league = useLeague();
  const isMobile = useIsMobile();
  const { status: seasonStatus } = useSeasonStatus();

  const native = Capacitor.isNativePlatform();
  if (native) {
    const authSettling = auth?.loading ?? false;
    const leagueSettling = Boolean(auth?.user) && (league?.loading ?? false);
    if (authSettling || leagueSettling) {
      return <div style={{ minHeight: '100vh', background: '#0F1F15' }} aria-busy="true" />;
    }
  }

  const hasLeagues = (league?.userLeagues?.length ?? 0) > 0;
  if (auth?.user && hasLeagues && (native || isMobile)) {
    return <PressBoxHome inOffseason={seasonStatus.isDormant && seasonStatus.phase === 'offseason'} />;
  }

  try {
    return <Homepage />;
  } catch (error) {
    logger.error('❌ Error in Index component:', error);
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h1>Error loading page</h1>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }
};

export default Index;
