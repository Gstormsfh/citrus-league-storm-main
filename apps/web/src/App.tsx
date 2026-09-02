import React, { Suspense, lazy } from "react";
import { CitrusToaster } from "@/components/notifications/CitrusToaster";
import { logger } from '@/utils/logger';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LeagueProvider } from "@/contexts/LeagueContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { StormyChatBubble } from "./components/StormyChatBubble";
import MobileBottomNav from "./components/MobileBottomNav";
import NativeBootSplash from "./components/NativeBootSplash";
import { LeagueLoadErrorBanner } from "./components/LeagueLoadErrorBanner";
import { CookieConsent } from "./components/CookieConsent";
import ScrollToTop from "./components/ScrollToTop";
import PushDeepLink from "./components/PushDeepLink";
import NativeAuthDeepLink from "./components/NativeAuthDeepLink";
import LoadingScreen from "./components/LoadingScreen";
import '@/integrations/firebase/config'; // Initialize Firebase
import "./App.css";


// Helper to add error handling to lazy imports - auto-reloads on stale chunks after deploy
const lazyWithErrorHandling = (importFn: () => Promise<{ default: React.ComponentType }>) => {
  return lazy(() =>
    importFn().catch((error) => {
      const msg = error?.message || String(error);
      const isChunkError = msg.includes('Failed to fetch dynamically imported module')
        || msg.includes('Unexpected token')
        || msg.includes('Loading chunk')
        || msg.includes('Loading CSS chunk');

      if (isChunkError) {
        const lastReload = sessionStorage.getItem('chunk_reload');
        const now = Date.now();
        if (!lastReload || now - parseInt(lastReload) > 30000) {
          sessionStorage.setItem('chunk_reload', String(now));
          window.location.reload();
        }
      }

      return {
        default: () => (
          <div style={{ padding: "40px", textAlign: "center" }}>
            <h1 style={{ color: "#dc2626", marginBottom: "16px" }}>⚠️ Component Failed to Load</h1>
            <p style={{ color: "#666", marginBottom: "16px" }}>This page could not be loaded.</p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "8px 24px", background: "#2563eb", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "14px" }}
            >
              Reload Page
            </button>
          </div>
        ),
      };
    })
  );
};

// Load Index synchronously to avoid lazy loading issues on homepage
import Index from "./pages/Index";
// Lazy load all other pages for code splitting with error handling
const NotFound = lazyWithErrorHandling(() => import("./pages/NotFound"));
const Roster = lazyWithErrorHandling(() => import("./pages/Roster"));
const Standings = lazyWithErrorHandling(() => import("./pages/Standings"));
const Contact = lazyWithErrorHandling(() => import("./pages/Contact"));
const Blog = lazyWithErrorHandling(() => import("./pages/Blog"));
const Podcasts = lazyWithErrorHandling(() => import("./pages/Podcasts"));
const Guides = lazyWithErrorHandling(() => import("./pages/Guides"));
const Matchup = lazyWithErrorHandling(() => import("./pages/Matchup"));
const Scores = lazyWithErrorHandling(() => import("./pages/Scores"));
const PlayoffBracket = lazyWithErrorHandling(() => import("./pages/PlayoffBracket"));
const FreeAgents = lazyWithErrorHandling(() => import("./pages/FreeAgents"));
const Players = lazyWithErrorHandling(() => import("./pages/Players"));
const PlayerDashboard = lazyWithErrorHandling(() => import("./pages/PlayerDashboard"));
const GMOffice = lazyWithErrorHandling(() => import("./pages/GMOffice"));
const StormyAssistant = lazyWithErrorHandling(() => import("./pages/StormyAssistant"));
const News = lazyWithErrorHandling(() => import("./pages/News"));
const DraftRoom = lazyWithErrorHandling(() => import("./pages/DraftRoom"));
// Phase 4.5 chunk 11g.5b: parallel v2 draft room consuming the
// chunk-11g.4 persistent engine via chunk-11g.5a's state machine.
// v1 DraftRoom continues to serve `/draft` and `/draft-room` for the
// cutover-safety window — chunk 11g.9 retires v1 once leagues have
// migrated. League-by-league rollout via the v2 URL.
const DraftRoomV2 = lazyWithErrorHandling(() => import("./pages/DraftRoomV2"));
const Profile = lazyWithErrorHandling(() => import("./pages/Profile"));
const TeamAnalytics = lazyWithErrorHandling(() => import("./pages/TeamAnalytics"));
const WaiverWire = lazyWithErrorHandling(() => import("./pages/WaiverWire"));
const ScheduleManager = lazyWithErrorHandling(() => import("./pages/ScheduleManager"));
const TradeAnalyzer = lazyWithErrorHandling(() => import("./pages/TradeAnalyzer"));
const ArmchairGM = lazyWithErrorHandling(() => import("./pages/ArmchairGM"));
const OtherTeam = lazyWithErrorHandling(() => import("./pages/OtherTeam"));
const CreateLeague = lazyWithErrorHandling(() => import("./pages/CreateLeague"));
const Features = lazyWithErrorHandling(() => import("./pages/Features"));
const Pricing = lazyWithErrorHandling(() => import("./pages/Pricing"));
const About = lazyWithErrorHandling(() => import("./pages/About"));
const Privacy = lazyWithErrorHandling(() => import("./pages/Privacy"));
const Terms = lazyWithErrorHandling(() => import("./pages/Terms"));
const Settings = lazyWithErrorHandling(() => import("./pages/Settings"));
const Auth = lazyWithErrorHandling(() => import("./pages/Auth"));
const AuthCallback = lazyWithErrorHandling(() => import("./pages/AuthCallback"));
const ProfileSetup = lazyWithErrorHandling(() => import("./pages/ProfileSetup"));
const ResetPassword = lazyWithErrorHandling(() => import("./pages/ResetPassword"));
const VerifyEmail = lazyWithErrorHandling(() => import("./pages/VerifyEmail"));
const LeagueDashboard = lazyWithErrorHandling(() => import("./pages/LeagueDashboard"));
const Waitlist = lazyWithErrorHandling(() => import("./pages/Waitlist"));
const PoolPickem = lazyWithErrorHandling(() => import("./pages/PoolPickem"));
const PoolSurvivor = lazyWithErrorHandling(() => import("./pages/PoolSurvivor"));
const PoolConfidence = lazyWithErrorHandling(() => import("./pages/PoolConfidence"));
const NHLPlayoffBracket = lazyWithErrorHandling(() => import("./pages/NHLPlayoffBracket"));
const PoolPlayoffBracket = lazyWithErrorHandling(() => import("./pages/PoolPlayoffBracket"));
const PoolPlayoffRoster = lazyWithErrorHandling(() => import("./pages/PoolPlayoffRoster"));
const PoolPlayoffConfidence = lazyWithErrorHandling(() => import("./pages/PoolPlayoffConfidence"));
const PoolPlayoffHub = lazyWithErrorHandling(() => import("./pages/PoolPlayoffHub"));
const Admin = lazyWithErrorHandling(() => import("./pages/Admin"));
const PreviewRedesign = lazyWithErrorHandling(() => import("./pages/PreviewRedesign"));
const PreviewMockups = lazyWithErrorHandling(() => import("./pages/PreviewMockups"));
const PreviewIndex = lazyWithErrorHandling(() => import("./pages/PreviewIndex"));
const PreviewAlmanac = lazyWithErrorHandling(() => import("./pages/PreviewAlmanac"));
const PreviewSunlight = lazyWithErrorHandling(() => import("./pages/PreviewSunlight"));
const PreviewPress = lazyWithErrorHandling(() => import("./pages/PreviewPress"));
const PreviewStadium = lazyWithErrorHandling(() => import("./pages/PreviewStadium"));
const PreviewPulse = lazyWithErrorHandling(() => import("./pages/PreviewPulse"));
const PreviewSquad = lazyWithErrorHandling(() => import("./pages/PreviewSquad"));
const PreviewArena = lazyWithErrorHandling(() => import("./pages/PreviewArena"));
const PreviewRink = lazyWithErrorHandling(() => import("./pages/PreviewRink"));
const PreviewBoards = lazyWithErrorHandling(() => import("./pages/PreviewBoards"));
const PreviewClone = lazyWithErrorHandling(() => import("./pages/PreviewClone"));
const PreviewDashboardPrimitives = lazyWithErrorHandling(() => import("./pages/PreviewDashboardPrimitives"));

// Use the picturesque LoadingScreen as the Suspense fallback for lazy-loaded routes
const PageLoader = () => <LoadingScreen />;

// ===================================================================
// EGRESS OPTIMIZATION: React Query Caching Configuration
// ===================================================================
// Reduces Supabase egress by 60-70% through intelligent client-side caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes (reduces repeated fetches)
      staleTime: 5 * 60 * 1000,
      // Keep unused data in cache for 10 minutes
      gcTime: 10 * 60 * 1000,
      // Don't refetch on window focus (reduces unnecessary calls)
      refetchOnWindowFocus: false,
      // Don't refetch on component mount if data is fresh
      refetchOnMount: false,
      // Retry failed requests only once
      retry: 1,
    },
  },
});

const App = () => {
  // Add timeout to detect if app is hanging (only in dev mode)
  React.useEffect(() => {
    if (import.meta.env.DEV) {
      const timeout = setTimeout(() => {
        const root = document.getElementById('root');
        if (root && root.textContent?.includes('Loading application...')) {
          logger.error("App appears to be stuck on loading screen");
        }
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        {/* App-open motion for the native shell only; browsers skip it. */}
        <NativeBootSplash />
        <AuthProvider>
          <TooltipProvider>
            <CitrusToaster />
            <Sonner position="top-right" closeButton />
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <a href="#main-content" className="skip-to-content">Skip to content</a>
              <ScrollToTop />
              <PushDeepLink />
              <NativeAuthDeepLink />
              <LeagueProvider>
                {/* Consumes LeagueContext.error, which nothing rendered
                    until the 2026-08-18 audit — a failed league load
                    silently became "you have no leagues, create one".
                    Mounted here so every page inherits it. */}
                <LeagueLoadErrorBanner />
                <Suspense fallback={<PageLoader />}>
                  <main id="main-content">
                  <Routes>
                    <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/profile-setup" element={<ProfileSetup />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/roster" element={<ErrorBoundary><Roster /></ErrorBoundary>} />
                <Route path="/standings" element={<ErrorBoundary><Standings /></ErrorBoundary>} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/blog" element={<Blog />} />
                <Route path="/podcasts" element={<Podcasts />} />
                <Route path="/guides" element={<Guides />} />
                    <Route path="/matchup/:leagueId/:weekId?" element={<ErrorBoundary><Matchup /></ErrorBoundary>} />
                    <Route path="/matchup" element={<ErrorBoundary><Matchup /></ErrorBoundary>} /> {/* Fallback for /matchup without params */}
                    <Route path="/league/:leagueId/playoffs" element={<ProtectedRoute><ErrorBoundary><PlayoffBracket /></ErrorBoundary></ProtectedRoute>} />
                {/* Live NHL scoreboard. Auth-only: the Citrus panel reads league rosters. */}
                <Route path="/scores" element={<ProtectedRoute><ErrorBoundary><Scores /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/free-agents" element={<ErrorBoundary><FreeAgents /></ErrorBoundary>} />
                <Route path="/players" element={<ProtectedRoute><ErrorBoundary><Players /></ErrorBoundary></ProtectedRoute>} />
                {/* COMPONENT 6.5 — the player dashboard, SHIPPED. The
                    composition lived at /preview-player-profile inside the
                    import.meta.env.DEV gate below, which is statically false
                    in a production build, so Rollup dropped the route and
                    nobody has ever seen it. This route is outside the gate.

                    Deliberately NOT wrapped in ProtectedRoute, unlike
                    /players. This is the shareable, deep-linkable surface
                    (spec PWS-1: "standalone deep-dive, SEO-indexable"), and
                    a shared link that bounces a signed-out visitor to /auth
                    is a dead link. The API still 401s — the endpoint is
                    behind authMiddleware — and the page renders that as its
                    own sign-in state, which is the honest version of the
                    same gate and the one that tells the visitor what to do. */}
                <Route path="/players/:playerId" element={<ErrorBoundary><PlayerDashboard /></ErrorBoundary>} />
                <Route path="/gm-office" element={<ProtectedRoute><ErrorBoundary><GMOffice /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/gm-office/stormy" element={<ProtectedRoute><ErrorBoundary><StormyAssistant /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/news" element={<News />} />
                <Route path="/draft-room" element={<ProtectedRoute><ErrorBoundary><DraftRoom /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/draft" element={<ProtectedRoute><ErrorBoundary><DraftRoom /></ErrorBoundary></ProtectedRoute>} /> {/* Fallback route */}
                {/* Phase 4.5 chunk 11g.5b — v2 draft room (chunk-11g.4 persistent engine path). */}
                <Route path="/draft-v2/:leagueId/:draftId?" element={<ProtectedRoute><ErrorBoundary><DraftRoomV2 /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/create-league" element={<ProtectedRoute><CreateLeague /></ProtectedRoute>} />
                <Route path="/league/:leagueId" element={<ProtectedRoute><ErrorBoundary><LeagueDashboard /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><ErrorBoundary><Profile /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/team-analytics" element={<ProtectedRoute><ErrorBoundary><TeamAnalytics /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/waiver-wire" element={<ProtectedRoute><ErrorBoundary><WaiverWire /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/schedule-manager" element={<ProtectedRoute><ErrorBoundary><ScheduleManager /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/trade-analyzer" element={<ProtectedRoute><ErrorBoundary><TradeAnalyzer /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/armchair-gm" element={<ErrorBoundary><ArmchairGM /></ErrorBoundary>} />
                <Route path="/team/:teamId" element={<ProtectedRoute><ErrorBoundary><OtherTeam /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/features" element={<Features />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/about" element={<About />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/settings" element={<ProtectedRoute><ErrorBoundary><Settings /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/admin" element={<ProtectedRoute><ErrorBoundary><Admin /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/waitlist" element={<Waitlist />} />
                <Route path="/pool/pickem" element={<ProtectedRoute><ErrorBoundary><PoolPickem /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/pool/survivor" element={<ProtectedRoute><ErrorBoundary><PoolSurvivor /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/pool/confidence" element={<ProtectedRoute><ErrorBoundary><PoolConfidence /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/nhl/playoffs" element={<ErrorBoundary><NHLPlayoffBracket /></ErrorBoundary>} />
                <Route path="/pool/playoff-bracket" element={<ProtectedRoute><ErrorBoundary><PoolPlayoffBracket /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/pool/playoff-roster" element={<ProtectedRoute><ErrorBoundary><PoolPlayoffRoster /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/pool/playoff-confidence" element={<ProtectedRoute><ErrorBoundary><PoolPlayoffConfidence /></ErrorBoundary></ProtectedRoute>} />
                <Route path="/pool/playoff-hub" element={<ProtectedRoute><ErrorBoundary><PoolPlayoffHub /></ErrorBoundary></ProtectedRoute>} />
                {/* Hidden preview routes for redesign work — not linked from anywhere in production nav */}
                {/* SWEEP (2026-08-15) — 15 unfinished preview mockups were shipping
                    publicly (168KB of chunks, reachable by URL in the App Store
                    build). DEV-only now: import.meta.env.DEV is statically false in
                    production, so Rollup drops both the routes and their chunks. */}
                {import.meta.env.DEV && (<>
                <Route path="/preview-redesign" element={<PreviewRedesign />} />
                <Route path="/preview-mockups" element={<PreviewMockups />} />
                <Route path="/previews" element={<PreviewIndex />} />
                <Route path="/preview-almanac" element={<PreviewAlmanac />} />
                <Route path="/preview-sunlight" element={<PreviewSunlight />} />
                <Route path="/preview-press" element={<PreviewPress />} />
                <Route path="/preview-stadium" element={<PreviewStadium />} />
                <Route path="/preview-pulse" element={<PreviewPulse />} />
                <Route path="/preview-squad" element={<PreviewSquad />} />
                <Route path="/preview-arena" element={<PreviewArena />} />
                <Route path="/preview-rink" element={<PreviewRink />} />
                <Route path="/preview-boards" element={<PreviewBoards />} />
                <Route path="/preview-clone" element={<PreviewClone />} />
                <Route path="/preview-dashboard-primitives" element={<PreviewDashboardPrimitives />} />
                </>)}
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
                  </main>
            </Suspense>
            <StormyChatBubble />
            <MobileBottomNav />
            <CookieConsent />
          </LeagueProvider>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
        </ErrorBoundary>
    </QueryClientProvider>
  );
};

export default App;
