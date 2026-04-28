import { useState, useRef, useEffect, useCallback } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import { useAuth } from '@/contexts/AuthContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Zap, MessageSquare, Clock, Shield, Settings, Crown, Send, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Narwhal } from '@/components/icons/Narwhal';
import { isGuestMode } from '@/utils/guestHelpers';
import { LeagueCreationCTA } from '@/components/LeagueCreationCTA';
import { CitrusBackground } from '@/components/CitrusBackground';
import { CitrusSparkle, CitrusLeaf, CitrusWedge } from '@/components/icons/CitrusIcons';
import { AdSpace } from '@/components/AdSpace';
import LeagueNotifications from '@/components/matchup/LeagueNotifications';
import { StormyService, fetchLeagueContext, fetchPlayoffPoolContext, type StormyMessage, type StormyContext } from '@/services/StormyService';
import { isPlayoffPoolLeague, getLeagueTypeFromSettings } from '@/utils/leagueTypeHelpers';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

const WEEKLY_LIMIT = 3; // 3 questions per matchup week

const StormyAssistant = () => {
  const { userLeagueState, activeLeagueId, activeLeague } = useLeague();
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState("chat");
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messagesUsed, setMessagesUsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const defaultGreeting = "Hey! I'm Stormy — your Assistant GM. I already know your league, your picks/roster, and the live playoff bracket. Ask me to review your team, suggest swaps, or break down any matchup. What do you want to tackle?";
  const apiHistoryRef = useRef<StormyMessage[]>((() => {
    try {
      const saved = localStorage.getItem('stormyApiHistory');
      if (saved) return JSON.parse(saved) as StormyMessage[];
    } catch { /* fall through */ }
    return [];
  })());
  // Cached league context (roster, matchup, team name) — fetched lazily on first message
  const leagueCtxRef = useRef<Partial<StormyContext> | null>(null);
  const leagueCtxFetchedForRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('stormyMessages');
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-50);
      }
    } catch { /* corrupted — fall through */ }
    return [{ id: '1', text: defaultGreeting, sender: 'stormy' as const, timestamp: new Date() }];
  });

  // Persist messages + API history to localStorage
  useEffect(() => {
    try { localStorage.setItem('stormyMessages', JSON.stringify(messages.slice(-50))); } catch { /* quota */ }
  }, [messages]);

  useEffect(() => {
    try { localStorage.setItem('stormyApiHistory', JSON.stringify(apiHistoryRef.current.slice(-50))); } catch { /* quota */ }
  });

  // Proactively warm the context as soon as the page loads so the user's
  // first message doesn't wait on a DB roundtrip. Investor feedback: Stormy
  // should feel instantly useful — no spinner delay on the first question.
  useEffect(() => {
    const leagueId = activeLeagueId;
    const userId = auth?.user?.id;
    if (!leagueId || !userId || leagueCtxFetchedForRef.current === leagueId) return;
    (async () => {
      try {
        const settingsLeagueType = getLeagueTypeFromSettings(
          (activeLeague?.settings as Record<string, unknown> | undefined) ?? null,
        );
        if (isPlayoffPoolLeague(settingsLeagueType)) {
          leagueCtxRef.current = await fetchPlayoffPoolContext(
            leagueId,
            userId,
            settingsLeagueType as 'playoff-roster-pool' | 'playoff-bracket-pickem' | 'playoff-confidence-pool',
          );
        } else {
          leagueCtxRef.current = await fetchLeagueContext(leagueId, userId);
        }
        leagueCtxFetchedForRef.current = leagueId;
      } catch { /* non-critical */ }
    })();
  }, [activeLeagueId, auth?.user?.id, activeLeague?.settings]);

  // Scroll-to-bottom: wrapped in requestAnimationFrame so DOM has committed
  // the new message before we measure scrollHeight (iOS Safari race).
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, activeTab, isLoading]);

  const buildContext = useCallback(async (): Promise<StormyContext> => {
    const ctx: StormyContext = { page: 'Stormy Assistant (full page)' };
    if (activeLeague) {
      ctx.leagueName = activeLeague.name;
      if (activeLeague.scoring_settings) {
        ctx.scoringSettings = JSON.stringify(activeLeague.scoring_settings);
      }
    }

    // Detect league type — playoff pools need completely different context.
    // Read settings.leagueType with fallback (activeLeagueFormat may default
    // to 'fantasy' during initial context hydration).
    const settingsLeagueType = getLeagueTypeFromSettings(
      (activeLeague?.settings as Record<string, unknown> | undefined) ?? null,
    );
    const isPlayoffPool = isPlayoffPoolLeague(settingsLeagueType);

    const leagueId = activeLeagueId;
    const userId = auth?.user?.id;
    if (leagueId && userId) {
      if (leagueCtxFetchedForRef.current !== leagueId) {
        try {
          if (isPlayoffPool) {
            leagueCtxRef.current = await fetchPlayoffPoolContext(
              leagueId,
              userId,
              settingsLeagueType as 'playoff-roster-pool' | 'playoff-bracket-pickem' | 'playoff-confidence-pool',
            );
          } else {
            leagueCtxRef.current = await fetchLeagueContext(leagueId, userId);
          }
          leagueCtxFetchedForRef.current = leagueId;
        } catch {
          // Non-critical — proceed without enriched context
        }
      }
      if (leagueCtxRef.current) {
        Object.assign(ctx, leagueCtxRef.current);
      }
    }

    return ctx;
  }, [activeLeague, activeLeagueId, auth?.user?.id]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      text,
      sender: 'user',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    apiHistoryRef.current.push({ role: 'user', content: text });

    try {
      const context = await buildContext();
      const result = await StormyService.sendMessage(
        text,
        apiHistoryRef.current.slice(0, -1),
        context,
      );

      const responseText = result.error || result.response || "I couldn't process that. Try again?";

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: responseText,
          sender: 'stormy',
          timestamp: new Date(),
        },
      ]);

      if (!result.error) {
        apiHistoryRef.current.push({ role: 'assistant', content: result.response });
        setMessagesUsed((prev) => prev + 1);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: "Something went wrong — give me a sec and try again.",
          sender: 'stormy',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, buildContext]);

  return (
    <div className="min-h-screen bg-[#D4E8B8] flex flex-col relative">
      <CitrusBackground density="light" />
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden sticky top-0 z-40 bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-center h-12 px-4">
          <h1 className="text-lg font-bold text-pastel-cream">Stormy Assistant</h1>
        </div>
      </div>

      <main className="w-full lg:pt-24 lg:pb-8 pb-[calc(5rem+env(safe-area-inset-bottom))] relative z-10">
        <div className="w-full m-0 p-0">
          <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6 lg:mx-0 lg:w-screen lg:relative lg:left-1/2 lg:-translate-x-1/2">
            {/* Main Content */}
            <div className="min-w-0 px-2 lg:px-6 order-1 lg:order-2">
              <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8 relative">
                  <CitrusLeaf className="absolute -top-4 -left-8 w-16 h-16 text-citrus-sage/15 rotate-12" />
                  <CitrusWedge className="absolute -top-2 -right-6 w-14 h-14 text-citrus-orange/15 -rotate-45" />

                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest mb-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_6px_0_rgba(27,48,34,0.2)] corduroy-texture relative overflow-hidden group">
                    <Narwhal className="h-12 w-12 text-citrus-cream relative z-10 group-hover:scale-110 transition-transform" />
                    <CitrusSparkle className="absolute top-1 right-1 w-8 h-8 text-citrus-cream/20 animate-pulse" />
                  </div>
                  <div className="flex items-center justify-center gap-3 mb-2">
                    <CitrusSparkle className="w-6 h-6 text-citrus-orange animate-pulse" />
                    <h1 className="text-4xl font-varsity font-black text-citrus-forest uppercase tracking-tight">Stormy AI Assistant</h1>
                    <CitrusSparkle className="w-6 h-6 text-citrus-sage animate-pulse" style={{ animationDelay: '0.5s' }} />
                  </div>
                  <p className="text-lg font-display text-citrus-charcoal">
                    Powered by Claude &middot; xG-aware fantasy hockey strategist
                  </p>
                </div>

                {/* Demo Mode */}
                {isGuestMode(userLeagueState) && (
                  <div className="mb-8 max-w-2xl mx-auto">
                    <LeagueCreationCTA
                      title="You're viewing demo Stormy Assistant"
                      description="Sign up to get personalized AI advice for your team and league."
                      variant="compact"
                    />
                  </div>
                )}

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 max-w-[400px] mx-auto mb-8 bg-citrus-cream corduroy-texture border-4 border-citrus-sage rounded-varsity shadow-patch p-2">
                    <TabsTrigger value="chat" className="gap-2 font-varsity font-bold data-[state=active]:bg-citrus-sage data-[state=active]:text-citrus-cream rounded-varsity">
                      <MessageSquare className="h-4 w-4" /> Chat
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="gap-2 font-varsity font-bold data-[state=active]:bg-citrus-orange data-[state=active]:text-citrus-cream rounded-varsity">
                      <Settings className="h-4 w-4" /> Settings
                    </TabsTrigger>
                  </TabsList>

                  {/* ── Chat Tab ─────────────────────────────────── */}
                  <TabsContent value="chat" className="mt-0">
                    <Card className="h-[calc(100vh-12rem)] sm:h-[650px] flex flex-col shadow-[0_8px_0_rgba(27,48,34,0.2)] border-4 border-citrus-forest rounded-[2rem] overflow-hidden corduroy-texture bg-citrus-cream">
                      <CardHeader className="border-b-4 border-citrus-sage bg-gradient-to-r from-citrus-sage/20 to-citrus-orange/20 px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-2 border-citrus-forest flex items-center justify-center shadow-patch">
                            <Narwhal className="h-7 w-7 text-citrus-cream" />
                          </div>
                          <div>
                            <CardTitle className="text-lg font-varsity font-black text-citrus-forest uppercase">Stormy</CardTitle>
                            <CardDescription className="flex items-center gap-1.5 text-xs font-display">
                              {isLoading ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin text-citrus-orange" />
                                  Thinking...
                                </>
                              ) : (
                                <>
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-citrus-sage opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-citrus-sage" />
                                  </span>
                                  Online &middot; Powered by Claude
                                </>
                              )}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="flex-1 p-0 overflow-hidden bg-citrus-cream/50 relative">
                        <div
                          ref={scrollRef}
                          className="h-full overflow-y-auto overscroll-contain p-4 sm:p-6"
                        >
                          <div className="space-y-6 max-w-3xl mx-auto">
                            {messages.map((msg) => (
                              <div
                                key={msg.id}
                                className={`flex gap-4 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                              >
                                {msg.sender === 'stormy' && (
                                  <Avatar className="h-10 w-10 border-2 border-citrus-sage bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/20 shadow-patch shrink-0">
                                    <AvatarFallback><Narwhal className="h-5 w-5 text-citrus-sage" /></AvatarFallback>
                                  </Avatar>
                                )}
                                <div
                                  className={`p-4 rounded-varsity text-sm shadow-patch leading-relaxed font-display border-2 whitespace-pre-wrap ${
                                    msg.sender === 'user'
                                      ? 'bg-gradient-to-br from-citrus-orange to-citrus-peach text-citrus-cream font-semibold border-citrus-forest'
                                      : 'bg-citrus-cream border-citrus-sage/40 text-citrus-charcoal'
                                  }`}
                                >
                                  {msg.text}
                                </div>
                              </div>
                            ))}

                            {/* Typing indicator */}
                            {isLoading && (
                              <div className="flex gap-4">
                                <Avatar className="h-10 w-10 border-2 border-citrus-sage bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/20 shadow-patch shrink-0">
                                  <AvatarFallback><Narwhal className="h-5 w-5 text-citrus-sage" /></AvatarFallback>
                                </Avatar>
                                <div className="p-4 rounded-varsity border-2 border-citrus-sage/40 bg-citrus-cream flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin text-citrus-sage" />
                                  <span className="text-sm text-citrus-charcoal/60 font-display">Stormy is analyzing...</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>

                      <CardFooter className="p-4 border-t-4 border-citrus-sage bg-gradient-to-r from-citrus-sage/10 to-citrus-orange/10">
                        <div className="max-w-3xl mx-auto w-full">
                          <form
                            className="flex w-full items-center gap-3"
                            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                          >
                            <Input
                              placeholder="Ask Stormy about trades, waivers, or start/sit decisions..."
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              className="flex-1 h-12 border-3 border-citrus-sage rounded-varsity bg-citrus-cream font-display"
                              autoFocus
                              disabled={isLoading}
                            />
                            <Button
                              type="submit"
                              size="icon"
                              className="h-12 w-12 rounded-varsity shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest hover:-translate-y-1 transition-all"
                              disabled={!inputValue.trim() || isLoading}
                            >
                              {isLoading ? (
                                <Loader2 className="h-5 w-5 text-citrus-cream animate-spin" />
                              ) : (
                                <Send className="h-5 w-5 text-citrus-cream" />
                              )}
                            </Button>
                          </form>
                          <div className="text-center mt-2">
                            <p className="text-xs font-display text-citrus-charcoal/70">
                              Stormy can make mistakes. Consider checking important stats.
                            </p>
                          </div>
                        </div>
                      </CardFooter>
                    </Card>
                  </TabsContent>

                  {/* ── Settings Tab ─────────────────────────────── */}
                  <TabsContent value="settings" className="mt-0 space-y-8">
                    <div className="grid md:grid-cols-2 gap-8">
                      {/* Usage Card */}
                      <Card className="border-4 border-citrus-orange shadow-[0_6px_0_rgba(27,48,34,0.2)] rounded-[2rem] corduroy-texture bg-citrus-cream h-full relative overflow-hidden">
                        <CitrusLeaf className="absolute top-2 right-2 w-20 h-20 text-citrus-orange/10 rotate-12" />
                        <CardHeader className="relative z-10">
                          <CardTitle className="flex items-center gap-2 font-varsity font-black text-citrus-forest uppercase">
                            <Zap className="h-6 w-6 text-citrus-orange" />
                            Matchup Week Usage
                          </CardTitle>
                          <CardDescription className="font-display text-citrus-charcoal">Questions remaining this week</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 relative z-10">
                          <div className="text-center py-4">
                            <div className="text-5xl font-varsity font-black text-citrus-orange mb-2">
                              {messagesUsed}<span className="text-xl text-citrus-charcoal font-display font-normal">/{WEEKLY_LIMIT}</span>
                            </div>
                            <p className="text-sm font-display text-citrus-charcoal">Questions Used This Week</p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-sm font-display">
                              <span className="font-semibold text-citrus-forest">Usage Level</span>
                              <span className="font-bold text-citrus-orange">
                                {Math.round((messagesUsed / WEEKLY_LIMIT) * 100)}%
                              </span>
                            </div>
                            <Progress value={(messagesUsed / WEEKLY_LIMIT) * 100} className="h-3 bg-citrus-sage/20" />
                          </div>

                          <div className="flex items-center justify-between p-3 bg-citrus-sage/10 border-2 border-citrus-sage/30 rounded-varsity text-sm">
                            <div className="flex items-center gap-2 font-display text-citrus-charcoal">
                              <Clock className="h-4 w-4" />
                              <span>Resets:</span>
                            </div>
                            <span className="font-varsity font-bold text-citrus-forest">Every 7 days</span>
                          </div>

                          <Button className="w-full bg-gradient-to-r from-citrus-orange to-citrus-peach hover:from-citrus-peach hover:to-citrus-orange text-citrus-cream border-4 border-citrus-forest rounded-varsity shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] font-varsity font-bold uppercase hover:-translate-y-1 transition-all">
                            <Crown className="h-5 w-5 mr-2" />
                            Upgrade to Unlimited
                          </Button>
                        </CardContent>
                      </Card>

                      {/* Configuration Card */}
                      <Card className="border-4 border-citrus-sage shadow-[0_6px_0_rgba(27,48,34,0.2)] rounded-[2rem] corduroy-texture bg-citrus-cream h-full relative overflow-hidden">
                        <CitrusWedge className="absolute top-2 right-2 w-20 h-20 text-citrus-sage/10 -rotate-12" />
                        <CardHeader className="relative z-10">
                          <CardTitle className="flex items-center gap-2 font-varsity font-black text-citrus-forest uppercase">
                            <Settings className="h-6 w-6 text-citrus-sage" />
                            Configuration
                          </CardTitle>
                          <CardDescription className="font-display text-citrus-charcoal">Customize Stormy's behavior</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 relative z-10">
                          <div className="flex items-center justify-between p-3 bg-citrus-cream/60 border-2 border-citrus-sage/30 rounded-varsity">
                            <div className="space-y-0.5">
                              <Label className="text-base font-varsity font-bold text-citrus-forest">Proactive Hints</Label>
                              <p className="text-sm font-display text-citrus-charcoal">Show suggestion bubbles on new pages</p>
                            </div>
                            <Switch defaultChecked />
                          </div>

                          <div className="flex items-center justify-between p-3 bg-citrus-cream/60 border-2 border-citrus-sage/30 rounded-varsity">
                            <div className="space-y-0.5">
                              <Label className="text-base font-varsity font-bold text-citrus-forest">Trade Alerts</Label>
                              <p className="text-sm font-display text-citrus-charcoal">Notify when a fair trade is found</p>
                            </div>
                            <Switch defaultChecked />
                          </div>

                          <div className="flex items-center justify-between p-3 bg-citrus-cream/60 border-2 border-citrus-sage/30 rounded-varsity">
                            <div className="space-y-0.5">
                              <Label className="text-base font-varsity font-bold text-citrus-forest">Personality Mode</Label>
                              <p className="text-sm font-display text-citrus-charcoal">Enable humorous / trash-talk style</p>
                            </div>
                            <Switch />
                          </div>

                          <div className="pt-4 border-t-2 border-citrus-sage/30">
                            <h4 className="text-sm font-varsity font-black mb-3 flex items-center gap-2 text-citrus-forest uppercase">
                              <Shield className="h-5 w-5 text-citrus-orange" /> Data & Privacy
                            </h4>
                            <p className="text-xs font-display text-citrus-charcoal leading-relaxed mb-3">
                              Stormy analyzes your league data to provide personalized insights. Chat history is stored privately and used only to improve your recommendations. Powered by Claude (Anthropic).
                            </p>
                            <Button variant="outline" size="sm" className="w-full border-2 border-citrus-sage rounded-varsity font-display font-semibold hover:bg-citrus-sage/10">
                              Clear Chat History
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>

            {/* Left Sidebar */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <AdSpace size="300x250" label="AI Sponsor" />
              </div>
            </aside>

            {/* Right Sidebar - Notifications */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-card border rounded-lg shadow-sm overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default StormyAssistant;
