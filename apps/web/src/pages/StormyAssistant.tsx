import { useState, useRef, useEffect, useCallback } from 'react';
import { useLeague } from '@/contexts/LeagueContext';
import { useAuth } from '@/contexts/AuthContext';
import Navbar from '@/components/Navbar';
import MobileMenuButton from '@/components/MobileMenuButton';
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
import { useSeasonStatus } from '@/hooks/useSeasonStatus';
import { shortDateLabel } from '@/components/scores/scoresFormat';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

// The server's WEEKLY_MESSAGE_LIMIT (server/src/services/
// StormyAssistantService.ts), which is the number actually enforced:
// checkUserWeeklyLimit counts stormy_chat_log rows in a rolling 7 days
// and refuses at 15. This read 3, so the meter on this page filled to
// 100 percent and showed 3/3 while the user still had 12 questions
// left. Display only, but it is the only place the allowance is shown.
const WEEKLY_LIMIT = 15;

const StormyAssistant = () => {
  const { userLeagueState, activeLeagueId, activeLeague } = useLeague();
  const auth = useAuth();
  const { status: seasonStatus } = useSeasonStatus();
  /**
   * STORMY IN THE OFFSEASON (2026-09-02 audit).
   *
   * The last NHL game was 2026-06-14 and the next is 2026-09-29, and this page
   * had no idea. It offered a "Start/sit help" chip for a night nobody plays,
   * told the reader it had "this week's matchup, and the live xG model ... all
   * loaded before you hit send" when neither the matchup nor anything live
   * exists, and metered the quota in "matchup weeks" during a 107-day gap
   * between them.
   *
   * Gated on the offseason specifically, not on `isDormant`: over Christmas
   * there IS a matchup in flight and a start/sit question is answerable on
   * Friday, so a three-day break must not rewrite any of this. `phase` reads
   * 'unknown' while the schedule loads and after a failed fetch, which leaves
   * every string below exactly as it shipped.
   */
  const inOffseason = seasonStatus.isDormant && seasonStatus.phase === 'offseason';
  const seasonOpensOn =
    inOffseason && seasonStatus.nextGameDate ? shortDateLabel(seasonStatus.nextGameDate) : null;
  const [activeTab, setActiveTab] = useState("chat");
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messagesUsed, setMessagesUsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const defaultGreeting = "Stormy here. I already have your league, your roster and picks, and the live playoff bracket in front of me. Ask me for a roster review, a start/sit, a waiver target, or a read on any matchup, and I'll show you the numbers behind the call.";
  /**
   * The greeting is the loudest claim on the page and it fails the same way
   * the chips do: "the live playoff bracket in front of me" describes a
   * bracket that ended 2026-06-14, and "a start/sit" is a question with no
   * answer until 2026-09-29. Same four subjects as the offseason chips, so
   * the opening line and the chips under it agree.
   */
  const offseasonGreeting = `Stormy here. The season is dark until ${seasonOpensOn ?? 'opening night'}, so there is no lineup to set and no matchup to read. What I do have is your league, your roster and picks, and the xG projections. Ask me about draft prep, keepers, or what any player is worth.`;
  const greeting = inOffseason ? offseasonGreeting : defaultGreeting;
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

  /**
   * WHY THE GREETING IS SWAPPED AND NOT SEEDED.
   *
   * The schedule arrives over the network a beat after first paint, so at the
   * moment `useState` runs the phase is still 'unknown'. Seeding from it would
   * make a slow or failed fetch open the page with whichever greeting lost the
   * race. The seed is therefore always the in-season text (the direction
   * `useSeasonStatus` is built to fail in) and this corrects it once a real
   * answer lands.
   *
   * The guard is the untouched opening message and nothing else: exactly one
   * message, id '1', from Stormy. The moment the reader has said anything the
   * transcript is theirs and this stops rewriting it. The id and timestamp are
   * preserved, so the same swap runs in reverse when the season opens.
   */
  useEffect(() => {
    setMessages((prev) =>
      prev.length === 1 && prev[0].id === '1' && prev[0].sender === 'stormy' && prev[0].text !== greeting
        ? [{ ...prev[0], text: greeting }]
        : prev,
    );
  }, [greeting]);

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
          text: "That one didn't get through. Give me a second and ask again.",
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
      <div className="lg:hidden sticky top-0 z-page-header bg-[#0F1F15]/95 backdrop-blur-xl border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="w-10" />
          <h1 className="text-lg font-bold text-pastel-cream">Stormy Assistant</h1>
          <MobileMenuButton />
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
                    {/* A starter chip is a promise that the question has an
                        answer. "Start/sit help" on 2026-09-02 does not: nobody
                        plays for 27 days, so every chip Stormy could return is
                        "no game". The offseason set asks the four questions that
                        ARE live in September — the draft, keepers, roster shape
                        and player value — which is the same ground the Draft Kit
                        covers. */}
                    {messages.length <= 2 && (
                      <div className="max-w-3xl mx-auto mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(inOffseason
                          ? [
                              { icon: CrossedSticksIcon, label: 'Draft prep' },
                              { icon: MaskIcon,          label: 'Keeper advice' },
                              { icon: ShiftIcon,         label: 'Roster targets' },
                              { icon: XGModelIcon,       label: 'Player research' },
                            ]
                          : [
                              { icon: CrossedSticksIcon, label: 'Review my roster' },
                              { icon: ScoreboardIcon,    label: 'Start/sit help' },
                              { icon: ShiftIcon,         label: 'Waiver targets' },
                              { icon: PuckIcon,          label: 'Trade advice' },
                            ]
                        ).map(({ icon: Icon, label }) => (
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
                            {/* The quota really is a rolling 7 days (see the
                                Resets row below), which only coincides with a
                                matchup week while matchups are being played.
                                Between 2026-06-14 and 2026-09-29 there are no
                                matchup weeks to spend a question in. */}
                            {inOffseason ? 'Question Usage' : 'Matchup Week Usage'}
                          </CardTitle>
                          <CardDescription className="text-white/55">
                            {inOffseason ? 'Questions remaining before the next reset' : 'Questions remaining this week'}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 relative z-10">
                          <div className="text-center py-4">
                            <div className="font-calistoga text-6xl text-pastel-orange tabular-nums leading-none">
                              {messagesUsed}<span className="text-2xl text-white/55 ml-1">/{WEEKLY_LIMIT}</span>
                            </div>
                            <p className="text-[10px] font-jbmono uppercase tracking-[0.32em] text-white/55 font-bold mt-2">
                              {inOffseason ? 'Questions Used' : 'Questions Used This Week'}
                            </p>
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
                      <li className="flex gap-2"><span className="text-pastel-orange">▸</span> Ask follow-ups, I keep the thread context</li>
                    </ul>
                  </div>
                </div>
                <div className="bg-[#1A2A20] ring-1 ring-white/10 rounded-2xl p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-2">
                    <RangeIcon className="w-4 h-4 text-pastel-orange" strokeWidth={2} />
                    <div className="font-jbmono text-[9px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">What I see</div>
                  </div>
                  {/* The capability claim has to survive the calendar. In the
                      offseason there is no matchup to load and nothing about the
                      xG model is live — it is projecting a season that has not
                      started. Naming what is missing, and the date it returns,
                      costs one clause and keeps the tile honest. */}
                  <p className="text-[11px] text-white/70 leading-relaxed">
                    {inOffseason
                      ? `Your active league, your roster and picks, and the xG projection model. No games until ${seasonOpensOn ?? 'the season opens'}, so there is no live matchup to read.`
                      : "Your active league, current roster, this week's matchup, and the live xG model. All loaded before you hit send."}
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
      <HockeyFooter variant="app" />
    </div>
  );
};

export default StormyAssistant;
