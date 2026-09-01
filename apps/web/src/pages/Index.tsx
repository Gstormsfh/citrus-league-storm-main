import { Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';
import { Homepage } from '@/components/citrus2';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';

/**
 * Production homepage. Renders the Citrus 2.0 Homepage composition (dark
 * forest, hockey-first, Citrus Squad mascots). The legacy pastel homepage
 * components live unchanged in `apps/web/src/components/` until every page
 * has migrated to citrus2.
 *
 * NATIVE BOOT DESTINATION (2026-08-31). The native app used to open on this
 * marketing homepage — a page with no app navigation at all — reported from
 * the iOS simulator as "there are no menus." A signed-in manager opening the
 * app wants their league, not the sales pitch, so the native shell boots to
 * League HQ (the same choice Yahoo and ESPN make). The web keeps the
 * homepage: that is the storefront.
 *
 * The loading hold matters: auth and league context resolve asynchronously
 * on cold start. Deciding before they settle would flash the marketing page
 * at every boot (or worse, strand a signed-in user there because `user` was
 * still null when we looked). While they settle we paint the splash ground
 * color and nothing else.
 */
const Index = () => {
  const auth = useAuth();
  const league = useLeague();

  if (Capacitor.isNativePlatform()) {
    const authSettling = auth?.loading ?? false;
    const leagueSettling = Boolean(auth?.user) && (league?.loading ?? false);
    if (authSettling || leagueSettling) {
      return <div style={{ minHeight: '100vh', background: '#0F1F15' }} aria-busy="true" />;
    }
    const activeLeagueId = league?.activeLeagueId ?? null;
    if (auth?.user && activeLeagueId) {
      return <Navigate to={`/league/${activeLeagueId}?league=${activeLeagueId}`} replace />;
    }
    // Signed out, or signed in with no leagues yet: the homepage's create/join
    // paths are the right destination.
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
