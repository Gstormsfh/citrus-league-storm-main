
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Menu, X, Bell, Search, Users, LogOut, CircleUser,
  Trophy, ChevronDown, UserPlus, Calendar, BarChart3,
  Swords, Newspaper, Sparkles, Settings, DollarSign
} from 'lucide-react';
import { CitrusLogo } from '@/components/icons/CitrusIcons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
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
  const profile = auth?.profile ?? null;
  const signOut = auth?.signOut ?? (async () => {});

  const league = useLeague();
  const activeLeagueId = league?.activeLeagueId ?? null;
  const activeLeague = league?.activeLeague ?? null;
  const userLeagues = league?.userLeagues ?? [];
  const setActiveLeagueId = league?.setActiveLeagueId ?? (() => {});
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

  const userInitial = profile?.username?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U';
  const displayName = profile?.username || user?.email?.split('@')[0] || 'User';

  // Flat navigation tabs — one click to anywhere
  // All items shown to all users for full feature discovery
  // GM Office and Draft redirect to /auth via ProtectedRoute if not logged in
  // Armchair GM is fully public (read-only NHL data)
  const navTabs = [
    { label: 'Matchup', path: activeLeagueId ? `/matchup/${activeLeagueId}` : '/matchup', icon: Swords },
    { label: 'Roster', path: '/roster', icon: Users },
    { label: 'Standings', path: '/standings', icon: BarChart3 },
    ...(activeLeagueId ? [{ label: 'Playoffs', path: `/league/${activeLeagueId}/playoffs`, icon: Trophy }] : []),
    { label: 'Players', path: '/free-agents', icon: Search },
    { label: 'GM Office', path: '/gm-office', icon: Settings },
    { label: 'Draft', path: '/draft-room', icon: Sparkles },
    { label: 'Armchair GM', path: '/armchair-gm', icon: DollarSign },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 w-full z-50 lg:block max-lg:py-2 max-lg:pt-[calc(0.5rem+env(safe-area-inset-top))] max-lg:bg-[#D4E8B8]/95 max-lg:dark:bg-citrus-forest/95 max-lg:backdrop-blur-lg max-lg:border-b max-lg:border-citrus-sage/20">
      {/* ===== ROW 1: Brand bar ===== */}
      <div className="hidden lg:block bg-citrus-forest">
        <div className="w-full px-6 h-12 flex items-center justify-between">
          {/* Left: Logo + League switcher */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5 group">
              <CitrusLogo className="w-8 h-8 drop-shadow-sm group-hover:rotate-12 transition-transform duration-200" />
              <span className="font-varsity font-black text-base uppercase text-citrus-cream tracking-tight">
                Citrus
              </span>
            </Link>

            {/* League switcher */}
            {userLeagues.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <Trophy className="h-4 w-4 text-citrus-orange" />
                    <span className="text-sm font-display font-semibold text-citrus-cream max-w-[200px] truncate">
                      {activeLeague?.name || 'Select League'}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-citrus-cream/60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-xs font-display uppercase text-citrus-forest">
                    My Leagues ({userLeagues.length})
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {userLeagues.map((l) => (
                    <DropdownMenuItem
                      key={l.id}
                      onClick={() => {
                        setActiveLeagueId(l.id);
                        if (location.pathname.startsWith('/matchup')) {
                          navigate(`/matchup/${l.id}`);
                        }
                      }}
                      className={cn(
                        "cursor-pointer",
                        activeLeagueId === l.id && "bg-citrus-sage/20 font-semibold"
                      )}
                    >
                      <Trophy className="h-4 w-4 mr-2" />
                      <div className="flex-1">
                        <div className="font-medium truncate">{l.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.draft_status === 'completed' ? 'Season Active' : 'Draft Pending'}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/create-league')} className="text-citrus-sage font-medium">
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
                  className="relative p-2.5 rounded-lg hover:bg-white/10 transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5 text-citrus-cream/80" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-citrus-orange text-[9px] font-bold text-white">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* User menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                      <div className="h-7 w-7 rounded-full bg-citrus-orange flex items-center justify-center text-white text-xs font-varsity font-bold">
                        {userInitial}
                      </div>
                      <span className="text-sm font-display font-medium text-citrus-cream hidden xl:inline">{displayName}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-citrus-cream/60 hidden xl:block" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="text-sm">{displayName}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/profile"><CircleUser className="h-4 w-4 mr-2" /> Profile</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/settings"><Settings className="h-4 w-4 mr-2" /> Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                      <LogOut className="h-4 w-4 mr-2" /> Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Button size="sm" className="h-9 px-6 text-sm font-display font-bold bg-citrus-sage hover:bg-citrus-sage/80 text-citrus-forest border-0 rounded-lg" asChild>
                <Link to="/auth">Sign In</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ===== ROW 2: Tab bar ===== */}
      <div className="hidden lg:block bg-[#D4E8B8] dark:bg-citrus-forest/90 border-b border-citrus-sage/30">
        <div className="w-full px-6">
          <nav className="flex items-center gap-0 h-11 -mb-px">
            {navTabs.map((tab) => {
              const active = isTabActive(tab.path);
              return (
                <Link
                  key={tab.label}
                  to={tab.path}
                  className={cn(
                    "flex items-center gap-2 px-5 h-11 text-[15px] font-display font-semibold transition-colors border-b-2 whitespace-nowrap",
                    active
                      ? "border-citrus-forest text-citrus-forest"
                      : "border-transparent text-citrus-charcoal/70 hover:text-citrus-forest hover:border-citrus-sage/50"
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
                  "flex items-center gap-2 px-4 h-11 text-[14px] font-display font-medium transition-colors border-b-2 whitespace-nowrap",
                  isTabActive('/news')
                    ? "border-citrus-forest text-citrus-forest"
                    : "border-transparent text-citrus-charcoal/50 hover:text-citrus-forest"
                )}
              >
                <Newspaper className="h-4 w-4" />
                News
              </Link>
              <Link
                to="/contact"
                className={cn(
                  "flex items-center gap-2 px-4 h-11 text-[14px] font-display font-medium transition-colors border-b-2 whitespace-nowrap",
                  isTabActive('/contact')
                    ? "border-citrus-forest text-citrus-forest"
                    : "border-transparent text-citrus-charcoal/50 hover:text-citrus-forest"
                )}
              >
                Contact
              </Link>
            </div>
          </nav>
        </div>
      </div>

      {/* ===== MOBILE: Top bar with logo + hamburger ===== */}
      <div className="lg:hidden container mx-auto px-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <CitrusLogo className="w-8 h-8 drop-shadow-sm" />
            <span className="font-varsity font-black text-base uppercase text-citrus-forest tracking-tight hidden sm:block">
              Citrus
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {user && (
              <button
                className="p-3 rounded-xl text-citrus-forest relative"
                onClick={() => activeLeagueId && navigate(`/matchup/${activeLeagueId}`)}
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-citrus-orange text-[9px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            )}
            <button
              className="p-3 rounded-xl text-citrus-forest"
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
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 top-[56px] z-50 bg-white/95 backdrop-blur-xl animate-in fade-in slide-in-from-top duration-200 shadow-2xl border-t border-citrus-sage/20">
          <div className="flex flex-col h-[calc(100dvh-56px-env(safe-area-inset-bottom)-4.5rem)] px-4 py-3 bg-gradient-to-b from-white to-[#F5F8ED]">
            {/* League context + switcher */}
            {userLeagues.length > 0 && (
              <div className="mb-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-3 px-3 py-2.5 bg-citrus-forest/5 rounded-xl w-full hover:bg-citrus-forest/10 transition-colors">
                      <Trophy className="h-4 w-4 text-citrus-orange flex-shrink-0" />
                      <span className="text-sm font-display font-semibold text-citrus-forest truncate flex-1 text-left">
                        {activeLeague?.name || 'Select League'}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 text-citrus-charcoal/50 flex-shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] max-w-[320px]">
                    <DropdownMenuLabel className="text-xs font-display uppercase text-citrus-forest">
                      My Leagues ({userLeagues.length})
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {userLeagues.map((l) => (
                      <DropdownMenuItem
                        key={l.id}
                        onClick={() => {
                          setActiveLeagueId(l.id);
                          if (location.pathname.startsWith('/matchup')) {
                            navigate(`/matchup/${l.id}`);
                          }
                          closeMobileMenu();
                        }}
                        className={cn(
                          "cursor-pointer",
                          activeLeagueId === l.id && "bg-citrus-sage/20 font-semibold"
                        )}
                      >
                        <Trophy className="h-4 w-4 mr-2" />
                        <div className="flex-1">
                          <div className="font-medium truncate">{l.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.draft_status === 'completed' ? 'Season Active' : 'Draft Pending'}
                          </div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { navigate('/create-league'); closeMobileMenu(); }} className="text-citrus-sage font-medium">
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
                      "flex items-center gap-3 px-3 py-3 rounded-xl transition-colors",
                      active ? "bg-citrus-sage/20 text-citrus-forest" : "text-citrus-charcoal/80"
                    )}
                  >
                    <tab.icon className="h-5 w-5" />
                    <span className="text-[15px] font-display font-medium">{tab.label}</span>
                    {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-citrus-orange" />}
                  </Link>
                );
              })}

              {/* Divider */}
              <div className="h-px bg-citrus-sage/20 my-3" />

              {/* Secondary links */}
              <Link to="/news" onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-citrus-charcoal/70">
                <Newspaper className="h-4 w-4" />
                <span className="text-[14px] font-display font-medium">News</span>
              </Link>
              <Link to="/blog" onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-citrus-charcoal/70">
                <Calendar className="h-4 w-4" />
                <span className="text-[14px] font-display font-medium">Blog</span>
              </Link>
              <Link to="/contact" onClick={closeMobileMenu} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-citrus-charcoal/70">
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
                    <Link to="/profile" onClick={closeMobileMenu} className="p-2 rounded-lg bg-citrus-sage/10">
                      <CircleUser className="h-4 w-4 text-citrus-forest" />
                    </Link>
                    <button onClick={handleSignOut} className="p-2 rounded-lg bg-red-50" aria-label="Sign out">
                      <LogOut className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              ) : (
                <Button className="w-full h-11 font-display font-bold rounded-xl bg-citrus-sage text-citrus-forest" asChild>
                  <Link to="/auth" onClick={closeMobileMenu}>Sign In</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>
        {`:root { --header-height: 92px; }`}
      </style>
    </header>
  );
};

export default Navbar;
