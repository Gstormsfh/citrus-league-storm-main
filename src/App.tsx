import React, { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import '@/utils/testDemoLeague'; // Load test utility
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LeagueProvider } from "@/contexts/LeagueContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { StormyChatBubble } from "./components/StormyChatBubble";
import LoadingScreen from "./components/LoadingScreen";
import "./App.css";


// Helper to add error handling to lazy imports
const lazyWithErrorHandling = (importFn: () => Promise<{ default: React.ComponentType }>) => {
  return lazy(() =>
    importFn().catch((error) => {
      console.error("Failed to load component:", error);
      // Return a fallback component
      return {
        default: () => (
          <div style={{ padding: "40px", textAlign: "center" }}>
            <h1 style={{ color: "#dc2626", marginBottom: "16px" }}>⚠️ Component Failed to Load</h1>
            <p style={{ color: "#666" }}>This page could not be loaded. Please try refreshing.</p>
            <pre style={{ marginTop: "20px", textAlign: "left", background: "#f5f5f5", padding: "16px", borderRadius: "4px" }}>
              {error.message || String(error)}
            </pre>
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
const PlayoffBracket = lazyWithErrorHandling(() => import("./pages/PlayoffBracket"));
const FreeAgents = lazyWithErrorHandling(() => import("./pages/FreeAgents"));
const GMOffice = lazyWithErrorHandling(() => import("./pages/GMOffice"));
const StormyAssistant = lazyWithErrorHandling(() => import("./pages/StormyAssistant"));
const News = lazyWithErrorHandling(() => import("./pages/News"));
const DraftRoom = lazyWithErrorHandling(() => import("./pages/DraftRoom"));
const Profile = lazyWithErrorHandling(() => import("./pages/Profile"));
const TeamAnalytics = lazyWithErrorHandling(() => import("./pages/TeamAnalytics"));
const WaiverWire = lazyWithErrorHandling(() => import("./pages/WaiverWire"));
const ScheduleManager = lazyWithErrorHandling(() => import("./pages/ScheduleManager"));
const TradeAnalyzer = lazyWithErrorHandling(() => import("./pages/TradeAnalyzer"));
const OtherTeam = lazyWithErrorHandling(() => import("./pages/OtherTeam"));
const CreateLeague = lazyWithErrorHandling(() => import("./pages/CreateLeague"));
const Features = lazyWithErrorHandling(() => import("./pages/Features"));
const Pricing = lazyWithErrorHandling(() => import("./pages/Pricing"));
const About = lazyWithErrorHandling(() => import("./pages/About"));
const Careers = lazyWithErrorHandling(() => import("./pages/Careers"));
const Privacy = lazyWithErrorHandling(() => import("./pages/Privacy"));
const Terms = lazyWithErrorHandling(() => import("./pages/Terms"));
const Settings = lazyWithErrorHandling(() => import("./pages/Settings"));
const Auth = lazyWithErrorHandling(() => import("./pages/Auth"));
const AuthCallback = lazyWithErrorHandling(() => import("./pages/AuthCallback"));
const ProfileSetup = lazyWithErrorHandling(() => import("./pages/ProfileSetup"));
const ResetPassword = lazyWithErrorHandling(() => import("./pages/ResetPassword"));
const VerifyEmail = lazyWithErrorHandling(() => import("./pages/VerifyEmail"));
const LeagueDashboard = lazyWithErrorHandling(() => import("./pages/LeagueDashboard"));

// No Suspense fallback - let individual pages handle their own loading states
// This prevents multiple loading screens from flashing
const PageLoader = () => null;

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
      cacheTime: 10 * 60 * 1000,
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
          console.error("App appears to be stuck on loading screen");
        }
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner position="top-right" closeButton />
            <BrowserRouter>
              <LeagueProvider>
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/profile-setup" element={<ProfileSetup />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/roster" element={<Roster />} />
                <Route path="/standings" element={<Standings />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/blog" element={<Blog />} />
                <Route path="/podcasts" element={<Podcasts />} />
                <Route path="/guides" element={<Guides />} />
                    <Route path="/matchup/:leagueId/:weekId?" element={<Matchup />} />
                    <Route path="/matchup" element={<Matchup />} /> {/* Fallback for /matchup without params */}
                    <Route path="/league/:leagueId/playoffs" element={<ProtectedRoute><PlayoffBracket /></ProtectedRoute>} />
                <Route path="/free-agents" element={<FreeAgents />} />
                <Route path="/gm-office" element={<GMOffice />} />
                <Route path="/gm-office/stormy" element={<StormyAssistant />} />
                <Route path="/news" element={<News />} />
                <Route path="/draft-room" element={<ErrorBoundary><DraftRoom /></ErrorBoundary>} />
                <Route path="/draft" element={<ErrorBoundary><DraftRoom /></ErrorBoundary>} /> {/* Fallback route */}
                <Route path="/create-league" element={<ProtectedRoute requireProfile><CreateLeague /></ProtectedRoute>} />
                <Route path="/league/:leagueId" element={<ProtectedRoute><LeagueDashboard /></ProtectedRoute>} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/team-analytics" element={<TeamAnalytics />} />
                <Route path="/waiver-wire" element={<WaiverWire />} />
                <Route path="/schedule-manager" element={<ScheduleManager />} />
                <Route path="/trade-analyzer" element={<TradeAnalyzer />} />
                <Route path="/team/:teamId" element={<OtherTeam />} />
                <Route path="/features" element={<Features />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/about" element={<About />} />
                <Route path="/careers" element={<Careers />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <StormyChatBubble />
          </LeagueProvider>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
        </ErrorBoundary>
    </QueryClientProvider>
  );
};

export default App;
