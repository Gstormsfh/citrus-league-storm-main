import { useState } from 'react';
import { Menu, X, Trophy, UserPlus, Newspaper, Calendar, LogOut, CircleUser, Settings } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useLeague } from '@/contexts/LeagueContext';
import { isPoolLeague, getPoolRoute, getPoolLabel, getLeagueTypeFromSettings } from '@/utils/leagueTypeHelpers';
import { CitrusLogo } from '@/components/icons/CitrusIcons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Swords, Users, BarChart3, Search, Sparkles, DollarSign,
  Target, Shield, TrendingUp,
} from 'lucide-react';

/**
 * Hamburger menu button for mobile page headers.
 * Opens a full-screen slide-in menu with all navigation links,
 * matching the Navbar's mobile menu.
 */
const MobileMenuButton = () => {
  const [menuOpen, setMenuOpen] = useState(false);
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
  const leagueLoading = league?.loading ?? false;
  const showPlayoffs = league?.showPlayoffs ?? false;

  const closeMenu = () => setMenuOpen(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    closeMenu();
  };

  const isTabActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    const base = '/' + path.split('/')[1];
    return location.pathname.startsWith(base);
  };

  const displayName = profile?.display_name || profile?.username || user?.email?.split('@')[0] || 'User';
  const userInitial = displayName.charAt(0).toUpperCase();

  const leagueType = league?.activeLeagueFormat?.leagueType;
  const isPool = isPoolLeague(leagueType);

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
      default:
        return [];
    }
  };

  const navTabs = isPool && activeLeagueId
    ? getPoolTabs()
    : [
        { label: 'Matchup', path: activeLeagueId ? `/matchup/${activeLeagueId}` : '/matchup', icon: Swords },
        { label: 'Roster', path: '/roster', icon: Users },
        { label: 'Standings', path: '/standings', icon: BarChart3 },
        ...(showPlayoffs && activeLeagueId ? [{ label: 'Playoffs', path: `/league/${activeLeagueId}/playoffs`, icon: Trophy }] : []),
        { label: 'Players', path: '/free-agents', icon: Search },
        { label: 'GM Office', path: '/gm-office', icon: Settings },
        { label: 'Draft', path: activeLeagueId ? `/draft-room?league=${activeLeagueId}` : '/draft-room', icon: Sparkles },
        { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
      ];

  return (
    <>
      <button
        className="p-2 rounded-xl text-citrus-forest active:bg-citrus-sage/20 transition-colors"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Full-screen slide-in menu */}
      {menuOpen && (
        <div className="fixed inset-0 top-0 z-[60] bg-white/95 backdrop-blur-xl animate-in fade-in slide-in-from-top duration-200 shadow-2xl">
          <div className="flex flex-col h-[calc(100dvh-env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+0.75rem)] px-4 pb-3 bg-gradient-to-b from-white to-[#F5F8ED]">
            {/* Close button + logo */}
            <div className="flex items-center justify-between mb-4">
              <Link to="/" onClick={closeMenu} className="flex items-center gap-2">
                <CitrusLogo className="w-8 h-8 drop-shadow-sm" />
                <span className="font-varsity font-black text-base uppercase text-citrus-forest tracking-tight">Citrus</span>
              </Link>
              <button
                className="p-2.5 rounded-xl text-citrus-forest"
                onClick={closeMenu}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* League switcher */}
            {userLeagues.length > 0 && !leagueLoading && (
              <div className="mb-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-3 px-3 py-2.5 bg-citrus-forest/5 rounded-xl w-full hover:bg-citrus-forest/10 transition-colors">
                      <Trophy className="h-4 w-4 text-citrus-orange flex-shrink-0" />
                      <span className="text-sm font-display font-semibold text-citrus-forest truncate flex-1 text-left">
                        {activeLeague?.name || 'Select League'}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] max-w-[320px]">
                    <DropdownMenuLabel className="text-xs font-display uppercase text-citrus-forest">
                      My Leagues ({userLeagues.length})
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {userLeagues.map((l) => {
                      const lType = getLeagueTypeFromSettings(l.settings as Record<string, unknown>);
                      return (
                        <DropdownMenuItem
                          key={l.id}
                          // onClick instead of onSelect — onSelect is unreliable on
                          // mobile touch where Radix's pointerdown handling can
                          // swallow the selection before it propagates.
                          onClick={() => {
                            setActiveLeagueId(l.id);
                            // Path-aware navigation: pages that use path-based league IDs
                            // (useParams) need an explicit navigate, otherwise the page
                            // sees the OLD league and either silently reverts the context
                            // (Matchup's syncLeagueFromUrl) or renders stale data
                            // (LeagueDashboard). Pool leagues also need explicit navigate.
                            if (isPoolLeague(lType)) {
                              navigate(getPoolRoute(lType, l.id));
                            } else if (location.pathname.startsWith('/matchup/') || location.pathname === '/matchup') {
                              navigate(`/matchup/${l.id}`);
                            } else if (location.pathname.match(/^\/league\/[^/]+\/playoffs$/)) {
                              navigate(`/league/${l.id}/playoffs`);
                            } else if (location.pathname.match(/^\/league\/[^/]+$/)) {
                              navigate(`/league/${l.id}`);
                            } else if (location.pathname.startsWith('/draft-room') || location.pathname === '/draft') {
                              // Don't trap users on the draft room of a different league —
                              // take them to GM Office so they can choose where to go.
                              navigate('/gm-office');
                            }
                            closeMenu();
                          }}
                          className={cn("cursor-pointer", activeLeagueId === l.id && "bg-citrus-sage/20 font-semibold")}
                        >
                          <Trophy className="h-4 w-4 mr-2" />
                          <div className="flex-1">
                            <div className="font-medium truncate">{l.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {isPoolLeague(lType) ? getPoolLabel(lType) + ' Pool' : 'Fantasy'}
                            </div>
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { navigate('/create-league'); closeMenu(); }} className="text-citrus-sage font-medium">
                      <UserPlus className="h-4 w-4 mr-2" /> Create / Join League
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto space-y-0.5">
              {navTabs.map((tab) => {
                const active = isTabActive(tab.path);
                return (
                  <Link
                    key={tab.label}
                    to={tab.path}
                    onClick={closeMenu}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-xl transition-colors',
                      active ? 'bg-citrus-sage/20 text-citrus-forest' : 'text-citrus-charcoal/80'
                    )}
                  >
                    <tab.icon className="h-5 w-5" />
                    <span className="text-[15px] font-display font-medium">{tab.label}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-citrus-orange" />}
                  </Link>
                );
              })}

              <div className="h-px bg-citrus-sage/20 my-3" />

              <Link to="/news" onClick={closeMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-citrus-charcoal/70">
                <Newspaper className="h-4 w-4" />
                <span className="text-[14px] font-display font-medium">News</span>
              </Link>
              <Link to="/blog" onClick={closeMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-citrus-charcoal/70">
                <Calendar className="h-4 w-4" />
                <span className="text-[14px] font-display font-medium">Blog</span>
              </Link>
              <Link to="/contact" onClick={closeMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-citrus-charcoal/70">
                <Newspaper className="h-4 w-4" />
                <span className="text-[14px] font-display font-medium">Contact</span>
              </Link>
            </nav>

            {/* User footer */}
            <div className="border-t border-citrus-sage/20 pt-3 mt-2 pb-safe">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-citrus-orange flex items-center justify-center text-white text-sm font-varsity font-bold">
                    {userInitial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-citrus-forest truncate">{displayName}</p>
                    <p className="text-xs text-citrus-charcoal/60 truncate">{user.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link to="/profile" onClick={closeMenu} className="p-2 rounded-lg bg-citrus-sage/10">
                      <CircleUser className="h-4 w-4 text-citrus-forest" />
                    </Link>
                    <button onClick={handleSignOut} className="p-2 rounded-lg bg-red-50" aria-label="Sign out">
                      <LogOut className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              ) : (
                <Button className="w-full h-11 font-display font-bold rounded-xl bg-citrus-sage text-citrus-forest" asChild>
                  <Link to="/auth" onClick={closeMenu}>Sign In</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MobileMenuButton;
