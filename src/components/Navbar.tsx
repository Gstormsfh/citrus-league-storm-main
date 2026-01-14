
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { 
  Menu, X, ChevronRight, User, Bell, Search, 
  Calendar, LineChart, Newspaper, Medal, Users, Settings, 
  LogOut, Home, FileText, Headphones, BookOpen, CircleUser, Sparkles,
  Trophy, ChevronDown, UserPlus
} from 'lucide-react';
import { CitrusSlice, CitrusSparkle } from '@/components/icons/CitrusIcons';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { 
  NavigationMenu, 
  NavigationMenuContent, 
  NavigationMenuItem, 
  NavigationMenuLink, 
  NavigationMenuList, 
  NavigationMenuTrigger 
} from "@/components/ui/navigation-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotificationStore } from '@/stores/notificationStore';

const Navbar = () => {
  console.log("✅ Navbar component rendering");
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  
  // Get auth - handle gracefully if context not ready
  const auth = useAuth();
  const user = auth?.user ?? null;
  const profile = auth?.profile ?? null;
  const signOut = auth?.signOut ?? (async () => {});

  // Get active league and notification count
  const league = useLeague();
  const activeLeagueId = league?.activeLeagueId ?? null;
  const activeLeague = league?.activeLeague ?? null;
  const userLeagues = league?.userLeagues ?? [];
  const setActiveLeagueId = league?.setActiveLeagueId ?? (() => {});
  const notificationStore = useNotificationStore();
  const unreadCount = activeLeagueId ? (notificationStore.unreadCounts.get(activeLeagueId) || 0) : 0;
  
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Load notifications for active league when it changes
  useEffect(() => {
    if (user?.id && activeLeagueId) {
      const notificationStore = useNotificationStore.getState();
      notificationStore.loadNotifications(activeLeagueId, user.id);
      notificationStore.subscribe(activeLeagueId, user.id);
      
      return () => {
        notificationStore.unsubscribe(activeLeagueId);
      };
    }
  }, [user?.id, activeLeagueId]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    closeMobileMenu();
  };

  // Check if the current path matches the link path
  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const userInitial = profile?.username?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U';
  const displayName = profile?.username || user?.email?.split('@')[0] || 'User';
  
  return (
    <header 
      className={cn(
        "fixed top-0 left-0 right-0 w-full z-50 transition-all duration-500", 
        isScrolled ? 
          "py-3 bg-citrus-cream/95 backdrop-blur-lg shadow-varsity border-b-4 border-citrus-sage/30" : 
          "py-5 bg-citrus-cream/90 backdrop-blur-sm border-b-2 border-citrus-sage/20"
      )}
    >
      <div className="container mx-auto px-4 max-w-full">
        {/* Main Navigation Row */}
        <div className="flex items-center justify-between">
          {/* Logo with Citrus Slice - Vintage Varsity Style */}
          <Link to="/" className="flex items-center gap-3 group relative">
            <div className="w-11 h-11 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-3 border-citrus-forest/20 flex items-center justify-center shadow-patch group-hover:shadow-varsity group-hover:-translate-y-0.5 transition-all duration-300 relative overflow-hidden">
              {/* Background pattern */}
              <div className="absolute inset-0 opacity-20">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(255,255,255,0.3)_0%,_transparent_60%)]"></div>
              </div>
              {/* Citrus Slice Icon */}
              <CitrusSlice className="w-7 h-7 relative z-10 text-citrus-cream group-hover:rotate-12 transition-transform duration-300" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-varsity font-black text-lg uppercase text-citrus-forest group-hover:text-citrus-orange transition-colors duration-300 tracking-tight">
                  Citrus
                </span>
                <CitrusSparkle className="w-3 h-3 text-citrus-orange opacity-60 group-hover:opacity-100 transition-opacity" />
              </div>
              <span className="text-[10px] text-citrus-charcoal font-display tracking-widest uppercase">Fantasy League</span>
            </div>
          </Link>

          {/* Desktop Navigation - Show to everyone for demo exploration */}
          <div className="hidden lg:flex items-center space-x-1">
              <NavigationMenu>
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger className={cn(
                      "text-sm font-varsity font-bold text-citrus-forest uppercase tracking-wide hover:text-citrus-orange transition-colors",
                      (isActive("/roster") || isActive("/gm-office")) && "text-citrus-orange"
                    )}>My Team</NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="w-[340px] p-3 grid gap-3 grid-cols-2 bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[1.5rem] shadow-[0_6px_0_rgba(27,48,34,0.25)]">
                        <Link to="/roster" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-sage/20 to-citrus-sage/10 p-4 no-underline outline-none border-3 border-citrus-sage/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                          <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Roster</div>
                          <p className="text-xs leading-tight font-display text-citrus-charcoal">Manage your team's lineup</p>
                          <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                        </Link>
                        <Link to="/gm-office" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-peach/20 to-citrus-orange/10 p-4 no-underline outline-none border-3 border-citrus-peach/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                          <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">GM's Office</div>
                          <p className="text-xs leading-tight font-display text-citrus-charcoal">Team operations center</p>
                          <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                        </Link>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                
                <NavigationMenuItem>
                  <NavigationMenuTrigger className={cn(
                    "text-sm font-varsity font-bold text-citrus-forest uppercase tracking-wide hover:text-citrus-orange transition-colors",
                    (isActive("/matchup") || isActive("/standings") || isActive("/free-agents") || isActive("/draft")) && "text-citrus-orange"
                  )}>League</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="w-[340px] p-3 grid gap-3 grid-cols-2 bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[1.5rem] shadow-[0_6px_0_rgba(27,48,34,0.25)]">
                      <Link to="/matchup" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-orange/20 to-citrus-peach/10 p-4 no-underline outline-none border-3 border-citrus-orange/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Matchup</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">Current matchups</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                      <Link to="/standings" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-sage/20 to-citrus-sage/10 p-4 no-underline outline-none border-3 border-citrus-sage/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Standings</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">League rankings</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                      <Link to="/draft-room" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-peach/20 to-citrus-orange/10 p-4 no-underline outline-none border-3 border-citrus-peach/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Draft Room</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">Live fantasy draft</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                      <Link to="/free-agents" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/10 p-4 no-underline outline-none border-3 border-citrus-sage/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Free Agents</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">Available players</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                
                <NavigationMenuItem>
                  <NavigationMenuTrigger className={cn(
                    "text-sm font-varsity font-bold text-citrus-forest uppercase tracking-wide hover:text-citrus-orange transition-colors",
                    (isActive("/blog") || isActive("/podcasts") || isActive("/guides") || isActive("/news")) && "text-citrus-orange"
                  )}>Resources</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="w-[340px] p-3 grid gap-3 grid-cols-2 bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[1.5rem] shadow-[0_6px_0_rgba(27,48,34,0.25)]">
                      <Link to="/news" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-orange/20 to-citrus-peach/10 p-4 no-underline outline-none border-3 border-citrus-orange/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">News</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">Latest fantasy updates</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                      <Link to="/create-league" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-sage/20 to-citrus-sage/10 p-4 no-underline outline-none border-3 border-citrus-sage/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Create League</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">Start a new league</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                      <Link to="/blog" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-peach/20 to-citrus-orange/10 p-4 no-underline outline-none border-3 border-citrus-peach/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Blog & Podcasts</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">Insights & Analysis</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                      <Link to="/guides" onClick={closeMobileMenu} className="flex h-full w-full select-none flex-col justify-end rounded-xl bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/10 p-4 no-underline outline-none border-3 border-citrus-sage/40 hover:shadow-patch hover:-translate-y-1 transition-all duration-200">
                        <div className="mb-1 mt-2 text-base font-varsity font-black text-citrus-forest uppercase">Strategy Guides</div>
                        <p className="text-xs leading-tight font-display text-citrus-charcoal">Winning tactics</p>
                        <ChevronRight className="h-4 w-4 mt-2 text-citrus-orange" />
                      </Link>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                
                <NavigationMenuItem>
                  <NavigationMenuLink asChild>
                    <Link to="/contact" className={cn(
                      "inline-flex items-center justify-center rounded-varsity h-9 px-4 py-1.5 text-sm font-varsity font-bold text-citrus-forest uppercase tracking-wide hover:text-citrus-cream hover:bg-citrus-orange border-2 border-transparent hover:border-citrus-forest transition-all",
                      isActive("/contact") && "text-citrus-cream bg-citrus-orange border-citrus-forest"
                    )}>
                      Contact
                    </Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* Right side navigation - Search, Notifications, User */}
          <div className="hidden lg:flex items-center space-x-2">
            {user ? (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-citrus-forest hover:text-citrus-orange hover:bg-citrus-sage/10 h-9 w-9 rounded-lg border-2 border-transparent hover:border-citrus-sage/30 transition-all">
                      <Search className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3">
                    <div className="flex flex-col space-y-3">
                      <h4 className="font-medium text-xs">Quick search</h4>
                      <div className="relative">
                        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          placeholder="Search players, teams..."
                          className="w-full rounded-md border border-input bg-background pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Press <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">⌘</kbd> + <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">K</kbd> to search
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* JOIN LEAGUE BUTTON - Always visible when logged in */}
                <Link to="/create-league?tab=join">
                  <Button 
                    variant="ghost" 
                    className="text-citrus-forest hover:text-citrus-orange hover:bg-citrus-sage/10 h-9 px-3 rounded-lg border-2 border-transparent hover:border-citrus-sage/30 transition-all flex items-center gap-1.5"
                  >
                    <UserPlus className="h-4 w-4" />
                    <span className="text-xs font-varsity font-bold uppercase hidden sm:inline">
                      Join League
                    </span>
                  </Button>
                </Link>

                {/* LEAGUE SWITCHER - Multi-League Support (Yahoo/Sleeper style) */}
                {userLeagues.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="text-citrus-forest hover:text-citrus-orange hover:bg-citrus-sage/10 h-9 px-3 rounded-lg border-2 border-transparent hover:border-citrus-sage/30 transition-all flex items-center gap-1.5"
                      >
                        <Trophy className="h-4 w-4" />
                        <span className="text-xs font-varsity font-bold uppercase max-w-[120px] truncate">
                          {activeLeague?.name || 'Select League'}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel className="text-xs font-varsity uppercase text-citrus-forest">
                        My Leagues ({userLeagues.length})
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {userLeagues.map((l) => (
                        <DropdownMenuItem
                          key={l.id}
                          onClick={() => {
                            setActiveLeagueId(l.id);
                            // Optionally navigate to league dashboard
                            navigate(`/league/${l.id}`);
                          }}
                          className={cn(
                            "cursor-pointer",
                            activeLeagueId === l.id && "bg-citrus-sage/10 text-citrus-orange font-semibold"
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
                      <DropdownMenuItem
                        onClick={() => navigate('/create-league')}
                        className="text-citrus-orange font-medium"
                      >
                        <Trophy className="h-4 w-4 mr-2" />
                        Create/Join League
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-citrus-forest hover:text-citrus-orange hover:bg-citrus-sage/10 relative h-9 w-9 rounded-lg border-2 border-transparent hover:border-citrus-sage/30 transition-all"
                      onClick={() => {
                        // Navigate to matchup page with notifications panel visible
                        if (activeLeagueId) {
                          navigate(`/matchup/${activeLeagueId}`);
                        }
                      }}
                    >
                      <Bell className="h-4 w-4" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-citrus-orange border-2 border-citrus-cream text-[9px] font-varsity font-bold text-citrus-cream shadow-patch">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-0">
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between p-3 border-b border-border/30">
                        <h4 className="font-medium text-xs">Notifications</h4>
                        {activeLeagueId && unreadCount > 0 && (
                          <Button 
                            variant="ghost" 
                            className="text-[10px] h-auto p-0 hover:bg-transparent hover:text-primary"
                            onClick={async () => {
                              if (user?.id && activeLeagueId) {
                                const notificationStore = useNotificationStore.getState();
                                await notificationStore.markAllAsRead(activeLeagueId, user.id);
                              }
                            }}
                          >
                            Mark all read
                          </Button>
                        )}
                      </div>
                      <div className="max-h-[250px] overflow-y-auto">
                        {activeLeagueId && user?.id ? (
                          (() => {
                            const notificationStore = useNotificationStore.getState();
                            const leagueNotifications = notificationStore.notifications.get(activeLeagueId) || [];
                            const recentNotifications = leagueNotifications.slice(0, 3);
                            
                            if (recentNotifications.length === 0) {
                              return (
                                <div className="p-4 text-center">
                                  <p className="text-xs text-muted-foreground">No notifications</p>
                                </div>
                              );
                            }
                            
                            return recentNotifications.map((notification) => (
                              <div 
                                key={notification.id} 
                                className="flex gap-2 p-2.5 hover:bg-accent/5 cursor-pointer border-b border-border/10"
                                onClick={() => {
                                  if (activeLeagueId) {
                                    navigate(`/matchup/${activeLeagueId}`);
                                  }
                                }}
                              >
                                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                  <Bell className="h-3 w-3" />
                                </div>
                                <div className="flex-1">
                                  <p className={`text-xs font-medium ${notification.read_status ? 'text-muted-foreground' : 'text-foreground'}`}>
                                    {notification.title}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground line-clamp-1">
                                    {notification.message}
                                  </p>
                                </div>
                                {!notification.read_status && (
                                  <div className="w-2 h-2 bg-primary rounded-full shrink-0 mt-1.5" />
                                )}
                              </div>
                            ));
                          })()
                        ) : (
                          <div className="p-4 text-center">
                            <p className="text-xs text-muted-foreground">Join a league to see notifications</p>
                          </div>
                        )}
                      </div>
                      {activeLeagueId && (
                        <div className="p-2.5">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full text-xs h-7"
                            onClick={() => navigate(`/matchup/${activeLeagueId}`)}
                          >
                            View all
                          </Button>
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                
                <div className="w-px h-7 bg-border/30 mx-1"></div>
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button className="bg-citrus-sage border-3 border-citrus-forest/20 rounded-xl flex gap-2 pl-2 pr-4 h-10 hover:shadow-patch hover:-translate-y-0.5 transition-all">
                      <div className="h-6 w-6 rounded-full bg-citrus-orange border-2 border-citrus-charcoal/20 flex items-center justify-center text-citrus-cream text-xs font-varsity font-bold shadow-sm">
                        {userInitial}
                      </div>
                      <span className="text-xs font-display font-bold text-citrus-forest">{displayName}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-48 p-1.5">
                    <div className="flex flex-col space-y-1">
                      <Button variant="ghost" className="justify-start text-xs h-8" asChild>
                        <Link to="/profile">
                          <CircleUser className="h-3.5 w-3.5 mr-2" /> Profile
                        </Link>
                      </Button>
                      <Button variant="ghost" className="justify-start text-xs h-8">
                        <Users className="h-3.5 w-3.5 mr-2" /> Subscription
                      </Button>
                      <Button 
                        variant="ghost" 
                        className="justify-start text-xs h-8 text-destructive hover:text-destructive"
                        onClick={handleSignOut}
                      >
                        <LogOut className="h-3.5 w-3.5 mr-2" /> Log out
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            ) : (
              <Button variant="varsity" size="sm" asChild>
                <Link to="/auth">Sign In</Link>
              </Button>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex lg:hidden items-center space-x-1">
            <Button variant="ghost" size="icon" className="text-foreground hover:text-primary h-9 w-9 rounded-md">
              <Search className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-foreground hover:text-primary h-9 w-9 rounded-md"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 top-[calc(var(--header-height)+1px)] z-50 bg-background/95 backdrop-blur-sm animate-in fade-in slide-in-from-top duration-300">
          <div className="container mx-auto px-4 py-5 h-[calc(100dvh-var(--header-height))] flex flex-col">
            <div className="flex-1 overflow-y-auto">
              <nav className="flex flex-col space-y-4">
                <MobileNavSection title="My Team">
                  <Link to="/roster" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Roster</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link to="/gm-office" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">GM's Office</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </MobileNavSection>
                
                <MobileNavSection title="League">
                  <Link to="/matchup" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Matchup</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link to="/draft" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Draft Room</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link to="/standings" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <LineChart className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Standings</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link to="/free-agents" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Free Agents</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </MobileNavSection>
                
                <MobileNavSection title="Resources">
                  <Link to="/news" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <Newspaper className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">News</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link to="/blog" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Blog</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link to="/podcasts" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <Headphones className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Podcasts</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  <Link to="/guides" className="flex items-center justify-between p-2.5 rounded-md hover:bg-accent/5" onClick={closeMobileMenu}>
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary/70" />
                      <span className="text-sm">Strategy Guides</span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </MobileNavSection>
                
                <Link to="/contact" className="bg-accent/5 flex items-center justify-between p-2.5 rounded-md" onClick={closeMobileMenu}>
                  <div className="flex items-center gap-2">
                    <Medal className="h-4 w-4 text-primary" />
                    <span className="text-sm">Contact</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
                
                {user && (
                  <div className="pt-4">
                    <div className="bg-primary/5 p-3 rounded-md mb-4">
                      <div className="flex items-center gap-3 mb-2">
                        <Bell className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Recent Activity</span>
                        {unreadCount > 0 && (
                          <span className="ml-auto bg-primary text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 mt-2">
                        {activeLeagueId ? (() => {
                          const notificationStore = useNotificationStore.getState();
                          const leagueNotifications = notificationStore.notifications.get(activeLeagueId) || [];
                          const recentNotifications = leagueNotifications.slice(0, 3);
                          
                          if (recentNotifications.length === 0) {
                            return (
                              <div className="bg-background rounded-md p-2 text-xs text-center text-muted-foreground">
                                No recent activity
                              </div>
                            );
                          }
                          
                          return recentNotifications.map((notification) => (
                            <div 
                              key={notification.id} 
                              className="bg-background rounded-md p-2 text-xs cursor-pointer hover:bg-accent/5"
                              onClick={() => {
                                if (activeLeagueId) {
                                  navigate(`/matchup/${activeLeagueId}`);
                                  closeMobileMenu();
                                }
                              }}
                            >
                              <p className={`font-medium ${notification.read_status ? 'text-muted-foreground' : 'text-foreground'}`}>
                                {notification.title}
                              </p>
                              <p className="text-muted-foreground text-[10px] mt-0.5 line-clamp-1">
                                {notification.message}
                              </p>
                            </div>
                          ));
                        })() : (
                          <div className="bg-background rounded-md p-2 text-xs text-center text-muted-foreground">
                            Join a league to see activity
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </nav>
            </div>
            
            {user ? (
              <div className="border-t border-border/30 pt-4 mt-4">
                <div className="flex space-x-3 items-center mb-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs">{userInitial}</div>
                  <div>
                    <p className="text-sm font-medium">{displayName}</p>
                    <p className="text-xs text-muted-foreground">User</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Button variant="outline" size="sm" className="w-full text-xs h-8" asChild>
                    <Link to="/profile" onClick={closeMobileMenu}>
                      <User className="h-3.5 w-3.5 mr-1.5" /> Profile
                    </Link>
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="col-span-2 w-full text-xs h-8 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1.5" /> Log out
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border/30 pt-4 mt-4">
                <Button variant="default" className="w-full" asChild onClick={closeMobileMenu}>
                  <Link to="/auth">Sign In</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>
        {`:root {
          --header-height: ${isScrolled ? '73px' : '89px'};
        }`}
      </style>
    </header>
  );
};

// Helper component for mobile navigation sections
const MobileNavSection = ({ title, children }: { title: string, children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="border-b border-border/20 pb-2">
      <button 
        className="w-full text-left py-2 flex justify-between items-center font-medium text-sm" 
        onClick={() => setIsOpen(!isOpen)}
      >
        {title}
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            isOpen ? "transform rotate-90" : ""
          )}
        />
      </button>
      {isOpen && (
        <div className="pl-2 space-y-0.5 mt-1">
          {children}
        </div>
      )}
    </div>
  );
};

export default Navbar;
