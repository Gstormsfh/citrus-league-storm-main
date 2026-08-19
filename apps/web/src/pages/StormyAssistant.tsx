import { useState, useRef, useEffect, useCallback } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import { useAuth } from '@/contexts/AuthContext';
import Navbar from '@/components/Navbar';
import {
  HockeyFooter,
  XGModelIcon,
  CrossedSticksIcon,
  PuckIcon,
  ScoreboardIcon,
  RangeIcon,
  ShiftIcon,
  MaskIcon,
  MascotAvatar,
} from '@/components/citrus2';
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
  // first message doesn't wait on a DB roundtrip.
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
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream flex flex-col relative">
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
                <div className="text-left mb-8">
                  <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1.5 flex items-center gap-2">
                    <XGModelIcon className="w-3.5 h-3.5" strokeWidth={2} />
                    ✦ AI Assistant GM
                  </div>
                  <h1 className="font-calistoga text-3xl sm:text-4xl text-pastel-cream leading-none mb-2">Stormy.</h1>
                  <p className="text-sm text-white/55 flex items-center gap-2">
                    <Narwhal className="h-4 w-4 text-pastel-orange" />
                    Powered by Claude · xG-aware fantasy hockey strategist
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
                  <TabsList className="grid w-full grid-cols-2 max-w-[400px] mx-auto mb-8 bg-[#1A2A20] ring-1 ring-white/10 p-1 rounded-xl">
                    <TabsTrigger
                      value="chat"
                      className="gap-2 text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                    >
                      <MessageSquare className="h-4 w-4" /> Chat
                    </TabsTrigger>
                    <TabsTrigger
                      value="settings"
                      className="gap-2 text-white/55 hover:text-pastel-cream font-bold data-[state=active]:bg-pastel-orange data-[state=active]:text-[#581E00] data-[state=active]:shadow-[0_4px_12px_-4px_rgba(255,168,87,0.4)]"
                    >
                      <Settings className="h-4 w-4" /> Settings
                    </TabsTrigger>
                  </TabsList>

                  {/* ── Chat Tab ─────────────────────────────────── */}
                  <TabsContent value="chat" className="mt-0">
                    <Card className="h-[calc(100vh-12rem)] sm:h-[650px] flex flex-col overflow-hidden bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]">
                      <CardHeader className="border-b border-white/10 bg-white/[0.03] px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-pastel-orange/30 to-pastel-orange/10 ring-1 ring-pastel-orange/40 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                            <Narwhal className="h-7 w-7 text-pastel-orange" />
                          </div>
                          <div className="min-w-0">
                            <CardTitle className="font-calistoga text-lg text-pastel-cream">Stormy</CardTitle>
                            <CardDescription className="flex items-center gap-1.5 text-xs">
                              {isLoading ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin text-pastel-orange" />
                                  <span className="text-white/55">Thinking…</span>
                                </>
                              ) : (
                                <>
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pastel-sage opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-pastel-sage" />
                                  </span>
                                  <span className="text-white/55">Online · Powered by Claude</span>
                                </>
                              )}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="flex-1 p-0 overflow-hidden bg-[#0F1F15] relative">
                        <div
                          ref={scrollRef}
                          className="h-full overflow-y-auto overscroll-contain p-4 sm:p-6"
                        >
                          <div className="space-y-5 max-w-3xl mx-auto">
                            {messages.map((msg) => (
                              <div
                                key={msg.id}
                                className={`flex gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                              >
                                {msg.sender === 'stormy' && (
                                  <Avatar className="h-9 w-9 ring-1 ring-pastel-orange/40 bg-pastel-orange/15 shrink-0">
                                    <AvatarFallback className="bg-transparent">
                                      <Narwhal className="h-5 w-5 text-pastel-orange" />
                                    </AvatarFallback>
                                  </Avatar>
                                )}
                                {msg.sender === 'user' ? (
                                  <div className="bg-white/5 ring-1 ring-white/10 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%] whitespace-pre-wrap text-sm text-pastel-cream leading-relaxed">
                                    <div className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/55 font-bold mb-1">YOU</div>
                                    {msg.text}
                                  </div>
                                ) : (
                                  <div className="bg-pastel-orange/10 ring-1 ring-pastel-orange/30 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] whitespace-pre-wrap text-sm text-pastel-cream leading-relaxed">
                                    <div className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold mb-1">STORMY</div>
                                    {msg.text}
                                  </div>
                                )}
                              </div>
                            ))}

                            {/* Typing indicator */}
                            {isLoading && (
                              <div className="flex gap-3">
                                <Avatar className="h-9 w-9 ring-1 ring-pastel-orange/40 bg-pastel-orange/15 shrink-0">
                                  <AvatarFallback className="bg-transparent">
                                    <Narwhal className="h-5 w-5 text-pastel-orange" />
                                  </AvatarFallback>
                                </Avatar>
                                <div className="bg-pastel-orange/10 ring-1 ring-pastel-orange/30 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2.5">
                                  <span className="flex gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-pastel-orange animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-pastel-orange animate-bounce" style={{ animationDelay: '120ms' }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-pastel-orange animate-bounce" style={{ animationDelay: '240ms' }} />
                                  </span>
                                  <span className="text-xs text-white/55">Stormy is analyzing the league…</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>

                      <CardFooter className="p-4 border-t border-white/10 bg-white/[0.03]">
                        <div className="max-w-3xl mx-auto w-full">
                          <form
                            className="flex w-full items-center gap-3"
                            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                          >
                            <Input
                              placeholder="Ask Stormy about trades, waivers, or start/sit decisions…"
                              value={inputValue}
                              onChange={(e) => setInputValue(e.target.value)}
                              className="flex-1 h-12 bg-white/5 border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
                              autoFocus
                              disabled={isLoading}
                            />
                            <Button
                              type="submit"
                              size="icon"
                              className="h-12 w-12 bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)] disabled:opacity-50"
                              disabled={!inputValue.trim() || isLoading}
                            >
                              {isLoading ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                              ) : (
                                <Send className="h-5 w-5" />
                              )}
                            </Button>
                          </form>
                          <div className="text-center mt-2">
                            <p className="text-xs text-white/55">
                              Stormy can make mistakes. Consider checking important stats.
                            </p>
                          </div>
                        </div>
                      </CardFooter>
                    </Card>

                    {/* Quick suggestion chips — visible only when chat is empty-ish */}
                    {messages.length <= 2 && (
                      <div className="max-w-3xl mx-auto mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { icon: CrossedSticksIcon, label: 'Review my roster' },
                          { icon: ScoreboardIcon,    label: 'Start/sit help' },
                          { icon: ShiftIcon,         label: 'Waiver targets' },
                          { icon: PuckIcon,          label: 'Trade advice' },
                        ].map(({ icon: Icon, label }) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setInputValue(label + ' please')}
                            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#1A2A20] ring-1 ring-white/10 hover:ring-pastel-orange/40 hover:bg-white/[0.07] transition-all group"
                          >
                            <Icon className="w-3.5 h-3.5 text-pastel-orange/70 group-hover:text-pastel-orange" strokeWidth={2} />
                            <span className="font-jbmono text-[10px] uppercase tracking-[0.18em] text-white/70 group-hover:text-pastel-cream font-bold">{label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Settings Tab ─────────────────────────────── */}
                  <TabsContent value="settings" className="mt-0 space-y-8">
                    <div className="grid md:grid-cols-2 gap-6">
                      {/* Usage Card */}
                      <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-orange/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(255,168,87,0.15)] h-full relative overflow-hidden">
                        <div aria-hidden="true" className="absolute -top-10 -right-10 w-44 h-44 bg-pastel-orange/15 rounded-full blur-3xl pointer-events-none" />
                        <CardHeader className="relative z-10">
                          <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                            <Zap className="h-5 w-5 text-pastel-orange" />
                            Matchup Week Usage
                          </CardTitle>
                          <CardDescription className="text-white/55">Questions remaining this week</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 relative z-10">
                          <div className="text-center py-4">
                            <div className="font-calistoga text-6xl text-pastel-orange tabular-nums leading-none">
                              {messagesUsed}<span className="text-2xl text-white/55 ml-1">/{WEEKLY_LIMIT}</span>
                            </div>
                            <p className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-white/55 font-bold mt-2">Questions Used This Week</p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-[10px] font-jbmono uppercase tracking-[0.22em] font-bold">
                              <span className="text-white/55">Usage Level</span>
                              <span className="text-pastel-orange tabular-nums">{Math.round((messagesUsed / WEEKLY_LIMIT) * 100)}%</span>
                            </div>
                            <Progress value={(messagesUsed / WEEKLY_LIMIT) * 100} className="h-1.5 bg-white/10" />
                          </div>

                          <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl text-sm">
                            <div className="flex items-center gap-2 text-white/55">
                              <Clock className="h-4 w-4 text-pastel-orange" />
                              <span>Resets:</span>
                            </div>
                            <span className="font-bold text-pastel-cream">Every 7 days</span>
                          </div>

                          <Button className="w-full bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft font-bold shadow-[0_8px_24px_-8px_rgba(255,168,87,0.5)]">
                            <Crown className="h-5 w-5 mr-2" />
                            Upgrade to Unlimited
                          </Button>
                        </CardContent>
                      </Card>

                      {/* Configuration Card */}
                      <Card className="bg-[#1A2A20] border-0 ring-1 ring-pastel-sage/30 rounded-2xl shadow-[0_16px_40px_-12px_rgba(166,211,160,0.15)] h-full relative overflow-hidden">
                        <div aria-hidden="true" className="absolute -top-10 -right-10 w-44 h-44 bg-pastel-sage/15 rounded-full blur-3xl pointer-events-none" />
                        <CardHeader className="relative z-10">
                          <CardTitle className="flex items-center gap-2 font-calistoga text-pastel-cream">
                            <Settings className="h-5 w-5 text-pastel-sage-soft" />
                            Configuration
                          </CardTitle>
                          <CardDescription className="text-white/55">Customize Stormy's behavior</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 relative z-10">
                          <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-bold text-pastel-cream">Proactive Hints</Label>
                              <p className="text-xs text-white/55">Show suggestion bubbles on new pages</p>
                            </div>
                            <Switch defaultChecked />
                          </div>

                          <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-bold text-pastel-cream">Trade Alerts</Label>
                              <p className="text-xs text-white/55">Notify when a fair trade is found</p>
                            </div>
                            <Switch defaultChecked />
                          </div>

                          <div className="flex items-center justify-between p-3 bg-white/5 ring-1 ring-white/10 rounded-xl">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-bold text-pastel-cream">Personality Mode</Label>
                              <p className="text-xs text-white/55">Enable humorous / trash-talk style</p>
                            </div>
                            <Switch />
                          </div>

                          <div className="pt-4 border-t border-white/10">
                            <h4 className="text-[10px] font-jbmono uppercase tracking-[0.32em] mb-2 flex items-center gap-2 text-pastel-orange-soft font-bold">
                              <Shield className="h-3.5 w-3.5" /> Data &amp; Privacy
                            </h4>
                            <p className="text-xs text-white/70 leading-relaxed mb-3">
                              Stormy analyzes your league data to provide personalized insights. Chat history is stored privately and used only to improve your recommendations. Powered by Claude (Anthropic).
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full bg-transparent border border-pastel-cream/30 text-pastel-cream hover:bg-white/5 hover:border-pastel-cream/50 font-bold"
                            >
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

            {/* Left Sidebar — AdSpace replaced with a Stormy-themed strategy
                tile that helps the user actually USE the assistant well. */}
            <aside className="w-full lg:w-auto order-2 lg:order-1">
              <div className="lg:sticky lg:top-24 space-y-4 lg:space-y-4">
                <div className="bg-[#1A2A20] ring-1 ring-pastel-orange/30 rounded-2xl p-5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] relative overflow-hidden">
                  <div aria-hidden="true" className="absolute -top-10 -right-10 w-36 h-36 bg-pastel-orange/15 rounded-full blur-3xl pointer-events-none" />
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-3">
                      <MascotAvatar id="stormy" size="sm" />
                      <div className="min-w-0">
                        <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">How to ask</div>
                        <div className="font-bold text-sm text-pastel-cream truncate">Get the best read</div>
                      </div>
                    </div>
                    <ul className="text-[11px] text-white/70 space-y-1.5 leading-relaxed">
                      <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Be specific: "Should I bench Y on a B2B?"</li>
                      <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Name your league situation if it matters</li>
                      <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Ask follow-ups — I keep the thread context</li>
                    </ul>
                  </div>
                </div>
                <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-2">
                    <RangeIcon className="w-4 h-4 text-pastel-orange" strokeWidth={2} />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">What I see</div>
                  </div>
                  <p className="text-[11px] text-white/70 leading-relaxed">
                    Your active league, current roster, this week's matchup, and the live xG model — all loaded before you hit send.
                  </p>
                </div>
              </div>
            </aside>

            {/* Right Sidebar - Notifications */}
            {userLeagueState === 'active-user' && activeLeagueId && (
              <aside className="hidden lg:block order-3">
                <div className="lg:sticky lg:top-24 h-[calc(100vh-7rem)] bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)] overflow-hidden">
                  <LeagueNotifications leagueId={activeLeagueId} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
      <HockeyFooter />
    </div>
  );
};

export default StormyAssistant;
