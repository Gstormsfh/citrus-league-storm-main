
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  Menu, X, Bell, Search, Users, LogOut, CircleUser,
  Trophy, ChevronDown, UserPlus, Calendar, BarChart3,
  Swords, Newspaper, Sparkles, Settings, DollarSign,
  Target, Shield, TrendingUp
} from 'lucide-react';
import { CitrusLogo } from '@/components/citrus2';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useLeague } from '@/contexts/LeagueContext';
import { isPoolLeague, getPoolRoute, getPoolLabel, getLeagueTypeFromSettings } from '@/utils/leagueTypeHelpers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/stores/notificationStore';

const Navbar = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const auth = useAuth();
  const user = auth?.user ?? null;
  const signOut = auth?.signOut ?? (async () => {});
  const { data: profile } = useProfile();

  const league = useLeague();
  const activeLeagueId = league?.activeLeagueId ?? null;
  const activeLeague = league?.activeLeague ?? null;
  const userLeagues = league?.userLeagues ?? [];
  const setActiveLeagueId = league?.setActiveLeagueId ?? (() => {});
  const showPlayoffs = league?.showPlayoffs ?? false;
  const leagueLoading = league?.loading ?? false;
  const notificationStore = useNotificationStore();
  const unreadCount = activeLeagueId ? (notificationStore.unreadCounts.get(activeLeagueId) || 0) : 0;

  useEffect(() => {
    if (user?.id && activeLeagueId) {
      const store = useNotificationStore.getState();
      store.loadNotifications(activeLeagueId, user.id);
      store.subscribe(activeLeagueId, user.id);
      return () => { store.unsubscribe(activeLeagueId); };
    }
  }, [user?.id, activeLeagueId]);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // SWEEP FIX (2026-08-16): Escape closes the mobile menu.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    closeMobileMenu();
  };

  // Check if current path matches a nav tab
  const isTabActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    const base = '/' + path.split('/')[1];
    return location.pathname.startsWith(base);
  };

  const displayName = profile?.display_name || profile?.username || user?.email?.split('@')[0] || 'User';
  const userInitial = displayName.charAt(0).toUpperCase();

  // Navigation tabs — adapt based on league type (fantasy vs pool)
  const formatLeagueType = league?.activeLeagueFormat?.leagueType;
  const rawLeagueType = (league?.activeLeague?.settings as Record<string, unknown> | undefined)?.leagueType as string | undefined;
  // Prefer format, fall back to raw settings so nav doesn't flash then revert
  const leagueType = (formatLeagueType && formatLeagueType !== 'fantasy') ? formatLeagueType : (rawLeagueType || formatLeagueType);
  const isPool = isPoolLeague(leagueType);

  // Build nav tabs per league type
  const getPoolTabs = () => {
    if (!activeLeagueId || !leagueType) return [];
    const poolRoute = getPoolRoute(leagueType, activeLeagueId);
    const standingsRoute = getPoolRoute(leagueType, activeLeagueId, 'standings');

    switch (leagueType) {
      case 'pickem':
        return [
          { label: 'Make Picks', path: poolRoute, icon: Target },
          { label: 'Standings', path: standingsRoute, icon: BarChart3 },
          { label: 'News', path: '/news', icon: Newspaper },
          { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
        ];
      case 'survivor':
        return [
          { label: 'My Pick', path: poolRoute, icon: Shield },
          { label: 'Standings', path: standingsRoute, icon: BarChart3 },
          { label: 'Pick History', path: getPoolRoute(leagueType, activeLeagueId, 'history'), icon: TrendingUp },
          { label: 'News', path: '/news', icon: Newspaper },
        ];
      case 'confidence-pool':
        return [
          { label: 'Rank Picks', path: poolRoute, icon: Target },
          { label: 'Standings', path: standingsRoute, icon: BarChart3 },
          { label: 'News', path: '/news', icon: Newspaper },
          { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
        ];
      case 'playoff-bracket-pickem':
        return [
          { label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}`, icon: Trophy },
          { label: 'My Picks', path: poolRoute, icon: Target },
          { label: 'NHL Bracket', path: '/nhl/playoffs', icon: BarChart3 },
        ];
      case 'playoff-confidence-pool':
        return [
          { label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}`, icon: Trophy },
          { label: 'My Picks', path: poolRoute, icon: Target },
          { label: 'NHL Bracket', path: '/nhl/playoffs', icon: BarChart3 },
        ];
      case 'playoff-roster-pool':
        return [
          { label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}`, icon: Trophy },
          { label: 'My Roster', path: poolRoute, icon: Users },
          { label: 'NHL Bracket', path: '/nhl/playoffs', icon: BarChart3 },
        ];
      default:
        return [];
    }
  };

  // SWEEP FIX (2026-08-16): fantasy leagues had NO nav tabs — the default
  // trio was playoff-era ("Playoffs front and center. Season-long still
  // accessible via direct URL"), which left league pages reachable only by
  // typing URLs. A user with an active season-long league now gets the
  // full league tab set; users with no league get Create League first.
  const navTabs = isPool && activeLeagueId
    ? getPoolTabs()
    : activeLeagueId && !isPool
      ? [
          { label: 'League HQ', path: `/league/${activeLeagueId}`, icon: Trophy },
          { label: 'Matchup', path: `/matchup/${activeLeagueId}`, icon: Swords },
          { label: 'Roster', path: `/roster?league=${activeLeagueId}`, icon: Users },
          { label: 'Free Agents', path: `/free-agents?league=${activeLeagueId}`, icon: UserPlus },
          { label: 'Standings', path: `/standings?league=${activeLeagueId}`, icon: TrendingUp },
        ]
      : [
          { label: 'Create League', path: '/create-league', icon: Sparkles },
          { label: 'NHL Playoffs', path: '/nhl/playoffs', icon: Trophy },
          { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
        ];

  return (
    <header className="fixed top-0 left-0 right-0 w-full z-50 lg:block max-lg:py-2 max-lg:pt-[calc(0.5rem+env(safe-area-inset-top))] max-lg:bg-pastel-surface/95 max-lg:backdrop-blur-lg max-lg:border-b max-lg:border-white/10">
      {/* ===== ROW 1: Brand bar ===== */}
      <div className="hidden lg:block bg-pastel-surface border-b border-white/5">
        <div className="w-full px-6 h-12 flex items-center justify-between">
          {/* Left: Logo + League switcher */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 group">
              <CitrusLogo className="w-7 h-7 group-hover:scale-110 transition-transform duration-300" variant="on-dark" />
              <span className="font-calistoga text-[20px] text-pastel-cream group-hover:text-pastel-orange-soft transition-colors">
                Citrus
              </span>
              <span className="block w-1.5 h-1.5 bg-pastel-orange rounded-full animate-pulse" />
            </Link>

            {/* League switcher */}
            {user && !leagueLoading && userLeagues.length === 0 && (
              <button
                onClick={() => navigate('/create-league')}
                className="focus-citrus flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/40 transition-all"
              >
                <UserPlus className="h-4 w-4 text-pastel-orange" />
                <span className="text-[13px] font-bold text-pastel-cream">
                  Create / Join League
                </span>
              </button>
            )}
            {user && leagueLoading && (
              <div className="flex items-center gap-2 px-3 py-1.5">
                <Trophy className="h-4 w-4 text-pastel-orange" />
                <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
              </div>
            )}
            {userLeagues.length > 0 && !leagueLoading && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="focus-citrus flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/40 transition-all">
                    <Trophy className="h-4 w-4 text-pastel-orange" />
                    <span className="text-[13px] font-bold text-pastel-cream max-w-[200px] truncate">
                      {activeLeague?.name || 'Select League'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-white/45" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 bg-pastel-surface-tile border-white/10 text-pastel-cream">
                  <DropdownMenuLabel className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">
                    My Leagues ({userLeagues.length})
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/10" />
                  {userLeagues.map((l) => {
                    const lType = getLeagueTypeFromSettings(l.settings as Record<string, unknown>);
                    return (
                    <DropdownMenuItem
                      key={l.id}
                      onSelect={() => {
                        setActiveLeagueId(l.id);
                        if (isPoolLeague(lType)) {
                          navigate(getPoolRoute(lType, l.id));
                        } else if (location.pathname.startsWith('/matchup/') || location.pathname === '/matchup') {
                          navigate(`/matchup/${l.id}`);
                        } else if (location.pathname.match(/^\/league\/[^/]+\/playoffs$/)) {
                          navigate(`/league/${l.id}/playoffs`);
                        } else if (location.pathname.match(/^\/league\/[^/]+$/)) {
                          navigate(`/league/${l.id}`);
                        } else if (location.pathname.startsWith('/draft-room') || location.pathname === '/draft') {
                          navigate('/gm-office');
                        } else {
                          // SWEEP FIX (2026-08-16): selecting a league from
                          // the home page (or any non-league page) previously
                          // did nothing visible — set context AND land the
                          // user in that league's HQ.
                          navigate(`/league/${l.id}`);
                        }
                      }}
                      className={cn(
                        "cursor-pointer text-pastel-cream focus:bg-white/5 focus:text-pastel-cream",
                        activeLeagueId === l.id && "bg-pastel-orange/15 font-bold ring-1 ring-pastel-orange/30"
                      )}
                    >
                      <Trophy className="h-4 w-4 mr-2 text-pastel-orange" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate">{l.name}</div>
                        <div className="text-[10px] font-jbmono uppercase tracking-wider text-white/45">
                          {isPoolLeague(lType) ? getPoolLabel(lType) + ' Pool' : (l.draft_status === 'completed' ? 'Season Active' : 'Draft Pending')}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  );})}
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onSelect={() => navigate('/create-league')} className="text-pastel-orange-soft font-bold focus:bg-pastel-orange/10 focus:text-pastel-orange">
                    <UserPlus className="h-4 w-4 mr-2" /> Create / Join League
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {/* Notifications */}
                <button
                  onClick={() => activeLeagueId && navigate(`/matchup/${activeLeagueId}`)}
                  className="focus-citrus relative p-2.5 rounded-md hover:bg-white/5 transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5 text-white/70" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-pastel-orange text-[9px] font-bold text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* User menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="focus-citrus flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors">
                      <div className="h-7 w-7 rounded-full bg-pastel-orange flex items-center justify-center text-white text-xs font-bold">
                        {userInitial}
                      </div>
                      <span className="text-[13px] font-bold text-pastel-cream hidden xl:inline">{displayName}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-white/45 hidden xl:block" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-pastel-surface-tile border-white/10 text-pastel-cream">
                    <DropdownMenuLabel className="text-[13px] font-bold text-pastel-cream">{displayName}</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem asChild className="text-pastel-cream focus:bg-white/5 focus:text-pastel-cream">
                      <Link to="/profile"><CircleUser className="h-4 w-4 mr-2 text-pastel-orange" /> Profile</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="text-pastel-cream focus:bg-white/5 focus:text-pastel-cream">
                      <Link to="/profile?tab=settings"><Settings className="h-4 w-4 mr-2 text-pastel-orange" /> Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem onSelect={handleSignOut} className="text-red-300 focus:bg-red-500/10 focus:text-red-200">
                      <LogOut className="h-4 w-4 mr-2" /> Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Button size="sm" className="h-9 px-6 text-[13px] font-bold bg-pastel-orange hover:bg-pastel-orange-soft text-white border-0 rounded-md shadow-[0_4px_12px_-4px_rgba(255,107,26,0.4)]" asChild>
                <Link to="/auth">Sign In</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ===== ROW 2: Tab bar ===== */}
      <div className="hidden lg:block bg-[#152821] border-b border-white/5">
        <div className="w-full px-6">
          <nav className="flex items-center gap-0 h-11 -mb-px">
            {navTabs.map((tab) => {
              const active = isTabActive(tab.path);
              return (
                <Link
                  key={tab.label}
                  to={tab.path}
                  className={cn(
                    "flex items-center gap-2 px-5 h-11 text-[13px] font-bold transition-all border-b-2 whitespace-nowrap",
                    active
                      ? "border-pastel-orange text-pastel-cream"
                      : "border-transparent text-white/55 hover:text-pastel-cream hover:border-pastel-orange/40"
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              );
            })}

            {/* Secondary links pushed right */}
            <div className="ml-auto flex items-center gap-0">
              <Link
                to="/news"
                className={cn(
                  "flex items-center gap-2 px-4 h-11 text-[13px] font-bold transition-all border-b-2 whitespace-nowrap",
                  isTabActive('/news')
                    ? "border-pastel-orange text-pastel-cream"
                    : "border-transparent text-white/45 hover:text-pastel-cream"
                )}
              >
                <Newspaper className="h-4 w-4" />
                News
              </Link>
              <Link
                to="/contact"
                className={cn(
                  "flex items-center gap-2 px-4 h-11 text-[13px] font-bold transition-all border-b-2 whitespace-nowrap",
                  isTabActive('/contact')
                    ? "border-pastel-orange text-pastel-cream"
                    : "border-transparent text-white/45 hover:text-pastel-cream"
                )}
              >
                Contact
              </Link>
            </div>
          </nav>
        </div>
      </div>

      {/* ===== MOBILE: Top bar with logo + league context + hamburger ===== */}
      <div className="lg:hidden container mx-auto px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link to="/" className="flex items-center gap-2 flex-shrink-0 group">
              <CitrusLogo className="w-7 h-7 group-hover:scale-110 transition-transform duration-300" variant="on-dark" />
              <span className="font-calistoga text-[16px] text-pastel-cream">Citrus</span>
            </Link>
            {leagueLoading ? (
              <div className="h-3 w-20 bg-white/10 rounded animate-pulse ml-1" />
            ) : activeLeague?.name ? (
              <span className="font-jbmono text-[10px] uppercase tracking-wider text-white/50 truncate max-w-[120px] ml-2">
                {activeLeague.name}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {user && (
              <button
                className="focus-citrus p-3 rounded-md text-pastel-cream/80 hover:text-pastel-cream relative transition-colors"
                onClick={() => activeLeagueId && navigate(`/matchup/${activeLeagueId}`)}
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-pastel-orange text-[9px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            )}
            <button
              className="focus-citrus p-3 rounded-md text-pastel-cream/80 hover:text-pastel-cream transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* ===== MOBILE: Slide-in menu ===== */}
      {/* PORTAL FIX (2026-08-17): the header's backdrop-blur makes the
          header the CONTAINING BLOCK for fixed descendants, so this
          panel's position:fixed resolved against the ~60px navbar box —
          collapsing it to a 4px strip whose solid background never
          painted behind the menu items. The items then floated over the
          page with no backdrop: Garrett's "transparent menu." Verified
          live (computed height 4px, top:56px inside a 60px box).
          Portaling to <body> restores true viewport positioning. */}
      {mobileMenuOpen && createPortal(
        // SWEEP FIX (2026-08-16): bg-pastel-surface/98 — /98 is not a
        // generated opacity step, so the class silently produced NO
        // background and the menu rendered transparent over page content.
        <div className="lg:hidden fixed inset-0 top-[56px] z-[70] bg-pastel-surface backdrop-blur-xl animate-in fade-in slide-in-from-top duration-200 shadow-2xl border-t border-white/10">
          <div className="flex flex-col h-[calc(100dvh-56px-env(safe-area-inset-bottom)-4.5rem)] px-4 py-3">
            {/* League context + switcher */}
            {user && !leagueLoading && userLeagues.length === 0 && (
              <div className="mb-3">
                <button
                  onClick={() => { navigate('/create-league'); closeMobileMenu(); }}
                  className="focus-citrus flex items-center gap-3 px-3 py-2.5 bg-white/5 ring-1 ring-pastel-orange/30 rounded-md w-full hover:bg-pastel-orange/10 hover:ring-pastel-orange/50 transition-all"
                >
                  <UserPlus className="h-4 w-4 text-pastel-orange flex-shrink-0" />
                  <span className="text-[13px] font-bold text-pastel-cream">
                    Create / Join League
                  </span>
                </button>
              </div>
            )}
            {user && leagueLoading && (
              <div className="mb-3 flex items-center gap-3 px-3 py-2.5 bg-white/5 rounded-md">
                <Trophy className="h-4 w-4 text-pastel-orange flex-shrink-0" />
                <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
              </div>
            )}
            {userLeagues.length > 0 && !leagueLoading && (
              <div className="mb-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="focus-citrus flex items-center gap-3 px-3 py-2.5 bg-white/5 ring-1 ring-white/10 rounded-md w-full hover:bg-white/10 hover:ring-pastel-orange/40 transition-all">
                      <Trophy className="h-4 w-4 text-pastel-orange flex-shrink-0" />
                      <span className="text-[13px] font-bold text-pastel-cream truncate flex-1 text-left">
                        {activeLeague?.name || 'Select League'}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 text-white/45 flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] max-w-[320px] bg-pastel-surface-tile border-white/10 text-pastel-cream">
                    <DropdownMenuLabel className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold">
                      My Leagues ({userLeagues.length})
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-white/10" />
                    {userLeagues.map((l) => {
                      const lType = getLeagueTypeFromSettings(l.settings as Record<string, unknown>);
                      return (
                      <DropdownMenuItem
                        key={l.id}
                        onSelect={() => {
                          setActiveLeagueId(l.id);
                          if (isPoolLeague(lType)) {
                            navigate(getPoolRoute(lType, l.id));
                          } else if (location.pathname.startsWith('/matchup/') || location.pathname === '/matchup') {
                            navigate(`/matchup/${l.id}`);
                          } else if (location.pathname.match(/^\/league\/[^/]+\/playoffs$/)) {
                            navigate(`/league/${l.id}/playoffs`);
                          } else if (location.pathname.match(/^\/league\/[^/]+$/)) {
                            navigate(`/league/${l.id}`);
                          } else if (location.pathname.startsWith('/draft-room') || location.pathname === '/draft') {
                            navigate('/gm-office');
                          } else {
                            // SWEEP FIX (2026-08-16): land in League HQ from
                            // home/any other page instead of a silent switch.
                            navigate(`/league/${l.id}`);
                          }
                          closeMobileMenu();
                        }}
                        className={cn(
                          "cursor-pointer text-pastel-cream focus:bg-white/5 focus:text-pastel-cream",
                          activeLeagueId === l.id && "bg-pastel-orange/15 font-bold ring-1 ring-pastel-orange/30"
                        )}
                      >
                        <Trophy className="h-4 w-4 mr-2 text-pastel-orange" />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold truncate">{l.name}</div>
                          <div className="text-[10px] font-jbmono uppercase tracking-wider text-white/45">
                            {isPoolLeague(lType) ? getPoolLabel(lType) + ' Pool' : (l.draft_status === 'completed' ? 'Season Active' : 'Draft Pending')}
                          </div>
                        </div>
                      </DropdownMenuItem>
                    );})}
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem onSelect={() => { navigate('/create-league'); closeMobileMenu(); }} className="text-pastel-orange-soft font-bold focus:bg-pastel-orange/10 focus:text-pastel-orange">
                      <UserPlus className="h-4 w-4 mr-2" /> Create / Join League
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Nav links - flat list */}
            <nav className="flex-1 overflow-y-auto space-y-0.5">
              {navTabs.map((tab) => {
                const active = isTabActive(tab.path);
                return (
                  <Link
                    key={tab.label}
                    to={tab.path}
                    onClick={closeMobileMenu}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-md transition-all",
                      active
                        ? "bg-pastel-orange/15 text-pastel-cream ring-1 ring-pastel-orange/30"
                        : "text-white/70 hover:text-pastel-cream hover:bg-white/5"
                    )}
                  >
                    <tab.icon className="h-5 w-5" />
                    <span className="text-[14px] font-bold">{tab.label}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-pastel-orange" />}
                  </Link>
                );
              })}

              {/* Divider */}
              <div className="h-px bg-white/10 my-3" />

              {/* Secondary links */}
              <Link to="/news" onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-md text-white/55 hover:text-pastel-cream hover:bg-white/5 transition-all">
                <Newspaper className="h-4 w-4" />
                <span className="text-[13px] font-bold">News</span>
              </Link>
              <Link to="/contact" onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-md text-white/55 hover:text-pastel-cream hover:bg-white/5 transition-all">
                <Newspaper className="h-4 w-4" />
                <span className="text-[13px] font-bold">Contact</span>
              </Link>
            </nav>

            {/* User footer */}
            <div className="border-t border-white/10 pt-3 mt-2 pb-safe">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-pastel-orange flex items-center justify-center text-white text-sm font-bold">
                    {userInitial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-pastel-cream truncate">{displayName}</p>
                    <p className="text-[11px] text-white/45 truncate">{user.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link to="/profile" onClick={closeMobileMenu} className="p-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors">
                      <CircleUser className="h-4 w-4 text-pastel-cream" />
                    </Link>
                    <button onClick={handleSignOut} className="focus-citrus p-2 rounded-md bg-red-500/10 hover:bg-red-500/20 transition-colors" aria-label="Sign out">
                      <LogOut className="h-4 w-4 text-red-400" />
                    </button>
                  </div>
                </div>
              ) : (
                <Button className="w-full h-11 font-bold rounded-md bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft" asChild>
                  <Link to="/auth" onClick={closeMobileMenu}>Sign In</Link>
                </Button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      <style>
        {`:root { --header-height: 92px; }`}
      </style>
    </header>
  );
};

export default Navbar;
