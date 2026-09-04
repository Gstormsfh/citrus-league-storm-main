import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X, Trophy, UserPlus, Newspaper, Calendar, LogOut, CircleUser, Settings, ChevronDown, Check } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useLeague } from '@/contexts/LeagueContext';
import { isPoolLeague, getPoolRoute, getPoolLabel, getLeagueTypeFromSettings, leagueSwitchDestination } from '@/utils/leagueTypeHelpers';
import { CitrusLogo } from '@/components/citrus2';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Swords, Users, BarChart3, Search, Sparkles, DollarSign,
  Target, Shield, TrendingUp, ClipboardList,
} from 'lucide-react';

/**
 * Hamburger menu button for mobile page headers.
 * Opens a full-screen slide-in menu with all navigation links,
 * matching the Navbar's mobile menu.
 */
const MobileMenuButton = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [leagueListOpen, setLeagueListOpen] = useState(false);
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

  // SWEEP FIX (2026-08-16): Escape closes the menu (a11y — keyboard users
  // previously had no way out short of tapping the X).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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
  // Prefer activeLeagueFormat, fall back to raw settings JSONB so the nav
  // doesn't briefly revert during state transitions.
  const rawLeagueType = (league?.activeLeague?.settings as Record<string, unknown> | undefined)?.leagueType as string | undefined;
  const effectiveLeagueType = (leagueType && leagueType !== 'fantasy') ? leagueType : (rawLeagueType || leagueType);
  const isPool = isPoolLeague(effectiveLeagueType);

  const getPoolTabs = () => {
    if (!activeLeagueId || !leagueType) return [];
    const resolvedType = effectiveLeagueType || 'fantasy';
    const poolRoute = getPoolRoute(resolvedType, activeLeagueId);
    const standingsRoute = getPoolRoute(resolvedType, activeLeagueId, 'standings');
    switch (effectiveLeagueType) {
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
          { label: 'Pick History', path: getPoolRoute(resolvedType, activeLeagueId, 'history'), icon: TrendingUp },
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
          { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
        ];
      case 'playoff-confidence-pool':
        return [
          { label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}`, icon: Trophy },
          { label: 'My Picks', path: poolRoute, icon: Target },
          { label: 'NHL Bracket', path: '/nhl/playoffs', icon: BarChart3 },
          { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
        ];
      case 'playoff-roster-pool':
        return [
          { label: 'Pool Home', path: `/pool/playoff-hub?league=${activeLeagueId}`, icon: Trophy },
          { label: 'My Roster', path: poolRoute, icon: Users },
          { label: 'NHL Bracket', path: '/nhl/playoffs', icon: BarChart3 },
          { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
        ];
      default:
        return [];
    }
  };

  // SWEEP FIX (2026-08-16): fantasy leagues had no nav links here — only
  // the stale playoff-era trio. Mirror of the Navbar fix.
  const navTabs = isPool && activeLeagueId
    ? getPoolTabs()
    : activeLeagueId && !isPool
      ? [
          { label: 'League HQ', path: `/league/${activeLeagueId}`, icon: Trophy },
          { label: 'Matchup', path: `/matchup/${activeLeagueId}`, icon: Swords },
          { label: 'Roster', path: `/roster?league=${activeLeagueId}`, icon: Users },
          { label: 'Free Agents', path: `/free-agents?league=${activeLeagueId}`, icon: UserPlus },
          { label: 'Standings', path: `/standings?league=${activeLeagueId}`, icon: TrendingUp },
          // See the Navbar note: the simulator is public and ungated, it was
          // just unreachable from inside a league.
          { label: 'Mock Draft', path: '/armchair-gm?tab=mockdraft', icon: ClipboardList },
        ]
      : [
          { label: 'Create League', path: '/create-league', icon: Sparkles },
          { label: 'NHL Playoffs', path: '/nhl/playoffs', icon: Trophy },
          { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
        ];

  return (
    <>
      <button
        className="focus-citrus inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 rounded-xl text-pastel-cream active:bg-white/10 transition-colors"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Full-screen slide-in menu — dark Citrus 2.0 panel */}
      {/* PORTAL FIX (2026-08-17): page headers using this button carry
          backdrop-blur, which makes them the containing block for fixed
          descendants — the same trap that collapsed the Navbar menu to a
          4px strip ("transparent menu"). Portal to <body> so
          position:fixed always means the viewport. */}
      {menuOpen && createPortal(
        <div className="fixed inset-0 top-0 z-menu bg-[#0F1F15]/95 backdrop-blur-xl animate-in fade-in slide-in-from-top duration-200 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]">
          <div className="flex flex-col h-[calc(100dvh-env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+0.75rem)] px-4 pb-3 bg-[#0F1F15] text-pastel-cream relative overflow-hidden">
            {/* Decorative orange + sage halos */}
            <div aria-hidden="true" className="absolute -top-32 -right-20 w-[420px] h-[420px] bg-pastel-orange/15 rounded-full blur-3xl pointer-events-none" />
            <div aria-hidden="true" className="absolute -bottom-24 -left-20 w-[320px] h-[320px] bg-pastel-sage/10 rounded-full blur-3xl pointer-events-none" />

            {/* Close button + logo */}
            <div className="flex items-center justify-between mb-4 relative z-10">
              <Link to="/" onClick={closeMenu} className="flex items-center gap-2">
                <CitrusLogo className="w-8 h-8" />
                <span className="font-calistoga text-lg text-pastel-cream leading-none">Citrus</span>
              </Link>
              <button
                className="focus-citrus inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-xl text-pastel-cream active:bg-white/10 transition-colors"
                onClick={closeMenu}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* League switcher — plain buttons, no Radix dropdown */}
            {userLeagues.length > 0 && !leagueLoading && (
              <div className="mb-3 relative z-10">
                <button
                  className="focus-citrus flex items-center gap-3 px-3 py-2.5 bg-white/5 ring-1 ring-white/10 rounded-xl w-full active:bg-white/[0.08] transition-colors"
                  onClick={() => setLeagueListOpen(prev => !prev)}
                >
                  <Trophy className="h-4 w-4 text-pastel-orange flex-shrink-0" />
                  <span className="text-sm font-bold text-pastel-cream truncate flex-1 text-left">
                    {activeLeague?.name || 'Select League'}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-white/55 transition-transform", leagueListOpen && "rotate-180")} />
                </button>

                {leagueListOpen && (
                  <div className="mt-1 rounded-xl ring-1 ring-white/10 bg-[#1A2A20] overflow-hidden shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                    <div className="px-3 py-2 text-[10px] font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft font-bold border-b border-white/10">
                      My Leagues ({userLeagues.length})
                    </div>
                    {/* SWITCHER REACH (2026-09-01): the creation affordance is
                        pinned directly under the label, before any league rows.
                        It used to sit last — twelve leagues pushed it past the
                        panel's clipped bottom edge with no way to reach it. The
                        rows scroll inside their own capped box below. */}
                    <button
                      className="focus-citrus flex items-center gap-3 w-full px-3 py-3 text-left active:bg-white/[0.08] transition-colors text-pastel-orange-soft font-bold border-b border-white/10"
                      onClick={() => { navigate('/create-league'); closeMenu(); }}
                    >
                      <UserPlus className="h-4 w-4" />
                      <span className="text-sm">Create / Join League</span>
                    </button>
                    <div className="max-h-[min(50vh,320px)] overflow-y-auto overscroll-contain">
                    {userLeagues.map((l) => {
                      const lType = getLeagueTypeFromSettings(l.settings as Record<string, unknown>);
                      const isActive = activeLeagueId === l.id;
                      return (
                        <button
                          key={l.id}
                          className={cn(
                            "focus-citrus flex items-center gap-3 w-full px-3 py-3 text-left active:bg-white/[0.08] transition-colors border-b border-white/10 last:border-b-0",
                            isActive && "bg-pastel-orange/10"
                          )}
                          onClick={() => {
                            setActiveLeagueId(l.id);
                            navigate(leagueSwitchDestination(l.id, lType, location.pathname));
                            setLeagueListOpen(false);
                            closeMenu();
                          }}
                        >
                          <Trophy className="h-4 w-4 text-pastel-orange flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-pastel-cream truncate">{l.name}</div>
                            <div className="text-xs text-white/55">
                              {isPoolLeague(lType) ? getPoolLabel(lType) + ' Pool' : 'Fantasy'}
                            </div>
                          </div>
                          {isActive && <Check className="h-4 w-4 text-pastel-orange flex-shrink-0" />}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto space-y-0.5 relative z-10">
              {navTabs.map((tab) => {
                const active = isTabActive(tab.path);
                return (
                  <Link
                    key={tab.label}
                    to={tab.path}
                    onClick={closeMenu}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-xl transition-colors',
                      active ? 'bg-pastel-orange/15 ring-1 ring-pastel-orange/40 text-pastel-orange-soft' : 'text-white/70 active:bg-white/5'
                    )}
                  >
                    <tab.icon className={cn("h-5 w-5", active && "text-pastel-orange")} />
                    <span className="text-[15px] font-bold">{tab.label}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-pastel-orange" />}
                  </Link>
                );
              })}

              <div className="h-px bg-white/10 my-3" />

              <Link to="/news" onClick={closeMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/55 active:bg-white/5 transition-colors">
                <Newspaper className="h-4 w-4" />
                <span className="text-[14px] font-bold">News</span>
              </Link>
              <Link to="/contact" onClick={closeMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/55 active:bg-white/5 transition-colors">
                <Newspaper className="h-4 w-4" />
                <span className="text-[14px] font-bold">Contact</span>
              </Link>
            </nav>

            {/* User footer */}
            <div className="border-t border-white/10 pt-3 mt-2 pb-safe relative z-10">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-pastel-orange/20 ring-1 ring-pastel-orange/40 flex items-center justify-center text-pastel-orange-soft text-sm font-bold">
                    {userInitial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-pastel-cream truncate">{displayName}</p>
                    <p className="text-xs text-white/55 truncate">{user.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link to="/profile" onClick={closeMenu} className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 rounded-lg bg-white/5 ring-1 ring-white/10 active:bg-white/[0.08] transition-colors">
                      <CircleUser className="h-4 w-4 text-pastel-cream" />
                    </Link>
                    <button onClick={handleSignOut} className="focus-citrus inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 rounded-lg bg-red-400/15 ring-1 ring-red-400/30 active:bg-red-400/25 transition-colors" aria-label="Sign out">
                      <LogOut className="h-4 w-4 text-red-300" />
                    </button>
                  </div>
                </div>
              ) : (
                <Button className="w-full h-11 font-bold rounded-xl bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]" asChild>
                  <Link to="/auth" onClick={closeMenu}>Sign In</Link>
                </Button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default MobileMenuButton;
