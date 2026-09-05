import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';
import { Homepage } from '@/components/citrus2';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSeasonStatus } from '@/hooks/useSeasonStatus';
import { PressBoxHome } from '@/components/home/PressBoxHome';
import { Navigate, useLocation } from 'react-router-dom';
import LoadingScreen from '@/components/LoadingScreen';

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
  const location = useLocation();

  const native = Capacitor.isNativePlatform();
  if (native) {
    const authSettling = auth?.loading ?? false;
    const leagueSettling = Boolean(auth?.user) && (league?.loading ?? false);
    if (authSettling || leagueSettling) {
      return <div style={{ minHeight: '100vh', background: '#0C1811' }} aria-busy="true" />;
    }
  }

  // A signed-in phone in a browser (no boot splash): while the leagues are
  // still loading, hold the home's skeleton rather than flash the storefront
  // and then swap it for the Press Box home (PR3, 2026-09-05). LoadingScreen
  // below lg is the skeleton of the screen the URL names -- here, home.
  if (auth?.user && !native && isMobile && (auth.loading || league?.loading)) {
    return <LoadingScreen />;
  }

  // THE SHELL OPENS ON THE DOOR (2026-09-05). Signed out in the iOS app,
  // the storefront and its pricing copy are the web's; the app opens on
  // sign in, the way every fantasy app does.
  if (native && !auth?.loading && !auth?.user) {
    return <Navigate to="/auth" replace />;
  }

  // A SIGNED-IN PHONE NEVER SEES THE STOREFRONT (2026-09-05, from a phone
  // screenshot: the Press Box nav and the Stormy bar under the Citrus 2.0
  // pitch page). This branch was gated on having a league, so a manager
  // whose leagues had not loaded, or who had none yet, got the sales pitch
  // with the app's chrome around it. PressBoxHome has its own no-leagues
  // state (`No leagues yet · + League`) and that is the screen.
  if (auth?.user && (native || isMobile)) {
    // LEAGUE HQ IS HOME (2026-09-05). "I want to see LEAGUE HQ when I log
    // in; it adds a lot more value, like a main menu." With an active league
    // the app opens on its HQ; the league list is one tap away (`?all=1`,
    // which is where SWITCH in the league menu and a second tap on LEAGUES
    // go). A manager with leagues but no active one still gets the list.
    const wantsList = new URLSearchParams(location.search).get('all') === '1';
    const activeId = league?.activeLeagueId;
    const hasLeagues = (league?.userLeagues?.length ?? 0) > 0;
    if (!wantsList && hasLeagues && activeId && league?.userLeagues?.some((l) => l.id === activeId)) {
      return <Navigate to={`/league/${activeId}`} replace />;
    }
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
