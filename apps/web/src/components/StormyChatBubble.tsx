import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { X, Send, Minimize2, Maximize2, Loader2 } from 'lucide-react';
import { Narwhal } from '@/components/icons/Narwhal';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';
import { StormyService, fetchLeagueContext, type StormyMessage, type StormyContext } from '@/services/StormyService';
import { useLeague } from '@/contexts/LeagueContext';
import { useAuth } from '@/contexts/AuthContext';

// ── Helpers ──────────────────────────────────────────────────────

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
};

const getPageLabel = (pathname: string): string => {
  if (pathname.includes('/roster')) return 'Roster';
  if (pathname.includes('/trade-analyzer')) return 'Trade Analyzer';
  if (pathname.includes('/free-agents')) return 'Free Agents';
  if (pathname.includes('/matchup')) return 'Matchup';
  if (pathname.includes('/team-analytics')) return 'Team Analytics';
  if (pathname.includes('/standings')) return 'Standings';
  if (pathname.includes('/draft-room')) return 'Draft Room';
  if (pathname.includes('/waiver-wire')) return 'Waiver Wire';
  if (pathname.includes('/gm-office')) return 'GM Office';
  if (pathname === '/') return 'Home';
  return 'App';
};

const getContextGreeting = (pathname: string): string => {
  if (pathname.includes('/roster'))
    return "I see you're looking at your roster. Need help with start/sit decisions or lineup moves?";
  if (pathname.includes('/trade-analyzer'))
    return "Analyzing a trade? I can break down the long-term value and xG impact for both sides.";
  if (pathname.includes('/free-agents'))
    return "Scouting the waiver wire? Ask me about players whose xG suggests they're about to heat up.";
  if (pathname.includes('/matchup'))
    return "Checking the scoreboard? I can help project your win probability for the week.";
  if (pathname.includes('/team-analytics'))
    return "Reviewing your team stats? I can pinpoint your biggest positional weakness.";
  if (pathname.includes('/standings'))
    return "Looking at the standings? Ask me about playoff scenarios or trade targets.";
  if (pathname.includes('/draft-room'))
    return "In the draft room! Want me to suggest the best available pick based on our projections?";
  return "Hey! I'm Stormy — your AI fantasy hockey analyst. Ask me anything about your team, trades, pickups, or the NHL.";
};

// ── Types ────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

// ── Component ────────────────────────────────────────────────────

export const StormyChatBubble = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const auth = useAuth();
  const league = useLeague();
  const activeLeague = league?.activeLeague ?? null;

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem('stormyMessages');
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-50);
      }
    } catch { /* corrupted storage — fall through to default */ }
    return [{ id: '1', text: getContextGreeting(location.pathname), sender: 'stormy', timestamp: new Date() }];
  });
  // Conversation history for the API (excludes the initial greeting)
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

  const scrollRef = useRef<HTMLDivElement>(null);

  // Persist messages + API history to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('stormyMessages', JSON.stringify(messages.slice(-50)));
    } catch { /* quota exceeded — silently drop */ }
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem('stormyApiHistory', JSON.stringify(apiHistoryRef.current.slice(-50)));
    } catch { /* quota exceeded */ }
  });

  // Update greeting when navigating (only if conversation hasn't started)
  useEffect(() => {
    if (apiHistoryRef.current.length === 0) {
      setMessages([
        { id: '1', text: getContextGreeting(location.pathname), sender: 'stormy', timestamp: new Date() },
      ]);
    }
  }, [location.pathname]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // Build context from current page + league data (merges cached league context)
  const buildContext = useCallback(async (): Promise<StormyContext> => {
    const ctx: StormyContext = { page: getPageLabel(location.pathname) };
    if (activeLeague) {
      ctx.leagueName = activeLeague.name;
      if (activeLeague.scoring_settings) {
        ctx.scoringSettings = JSON.stringify(activeLeague.scoring_settings);
      }
    }

    // Lazy-fetch league context (roster, matchup, team) on first message per league
    const leagueId = league?.activeLeagueId;
    const userId = auth?.user?.id;
    if (leagueId && userId) {
      if (leagueCtxFetchedForRef.current !== leagueId) {
        try {
          leagueCtxRef.current = await fetchLeagueContext(leagueId, userId);
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
  }, [location.pathname, activeLeague, league?.activeLeagueId, auth?.user?.id]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    // Add user message to UI
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      text,
      sender: 'user',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    // Add to API history
    apiHistoryRef.current.push({ role: 'user', content: text });

    try {
      const context = await buildContext();
      const result = await StormyService.sendMessage(
        text,
        apiHistoryRef.current.slice(0, -1), // exclude current msg (sent as `message`)
        context,
      );

      const responseText = result.error || result.response || "I couldn't process that. Try again?";

      // Add assistant response to UI + API history
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

  // ── Closed State (FAB) ─────────────────────────────────────────

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed h-14 w-14 rounded-varsity shadow-[0_6px_0_rgba(27,48,34,0.2)] bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest hover:scale-105 hover:-translate-y-1 transition-all z-[100] p-0 overflow-hidden"
        style={{
          position: 'fixed',
          bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom) + 4rem)' : '1.5rem',
          right: isMobile ? '1rem' : 'auto',
          left: isMobile ? 'auto' : '1.5rem',
          zIndex: 100,
        }}
      >
        <div className="absolute inset-0 opacity-20 corduroy-texture pointer-events-none" />
        <Narwhal className="h-7 w-7 text-[#E8EED9] relative z-10 pointer-events-none" />
        <span className="absolute -top-1 -right-1 h-3 w-3 bg-citrus-sage rounded-full border-2 border-citrus-cream animate-pulse shadow-[0_0_8px_rgba(120,149,97,0.6)] pointer-events-none" />
        <CitrusSparkle className="absolute top-1 left-1 w-3 h-3 text-[#E8EED9] opacity-70 pointer-events-none" />
      </Button>
    );
  }

  // ── Open State (Chat Card) ─────────────────────────────────────

  return (
    <Card
      className={`fixed w-[calc(100vw-3rem)] md:w-[380px] shadow-[0_8px_0_rgba(27,48,34,0.2)] border-4 border-citrus-forest rounded-[2rem] overflow-hidden flex flex-col transition-all duration-300 bg-[#E8EED9]/60 backdrop-blur-sm corduroy-texture ${isMinimized ? 'h-[70px]' : 'h-[min(400px,60vh)]'}`}
      style={{
        position: 'fixed',
        bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom) + 4rem)' : '1.5rem',
        right: isMobile ? '1rem' : 'auto',
        left: isMobile ? 'auto' : '1.5rem',
        zIndex: 100,
      }}
    >
      {/* Header */}
      <CardHeader className="p-4 bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-citrus-peach/10 border-b-4 border-citrus-forest flex flex-row items-center justify-between shrink-0 relative">
        <CitrusLeaf className="absolute top-2 right-20 w-8 h-8 text-citrus-sage opacity-10 rotate-12" />

        <div className="flex items-center gap-3 relative z-10">
          <div className="relative">
            <div className="h-10 w-10 rounded-varsity bg-gradient-to-br from-citrus-sage to-citrus-orange border-3 border-citrus-forest flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
              <Narwhal className="h-6 w-6 text-[#E8EED9]" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-citrus-sage rounded-full border-2 border-citrus-cream shadow-[0_0_8px_rgba(120,149,97,0.6)]" />
          </div>
          <div>
            <CardTitle className="text-base font-varsity font-black text-citrus-forest uppercase tracking-tight">
              Stormy
            </CardTitle>
            <p className="text-xs font-display text-citrus-charcoal flex items-center gap-1">
              <CitrusSparkle className="h-3 w-3 text-citrus-orange" />
              {isLoading ? 'Thinking...' : 'Powered by Claude'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 relative z-10">
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-citrus-sage/20 text-citrus-forest" onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-citrus-peach/30 text-citrus-forest" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {/* Chat Body */}
      {!isMinimized && (
        <>
          <CardContent className="flex-1 p-0 overflow-hidden bg-[#E8EED9]/60 backdrop-blur-sm/50 relative">
            <ScrollArea className="h-full p-4" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {msg.sender === 'stormy' && (
                      <Avatar className="h-8 w-8 border-2 border-citrus-sage bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/20 shadow-sm shrink-0">
                        <AvatarFallback className="bg-transparent">
                          <Narwhal className="h-4 w-4 text-citrus-forest" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl text-sm font-display shadow-sm whitespace-pre-wrap ${
                        msg.sender === 'user'
                          ? 'bg-gradient-to-br from-citrus-orange to-citrus-peach text-[#E8EED9] font-medium rounded-tr-none border-2 border-citrus-orange'
                          : 'bg-[#E8EED9]/60 backdrop-blur-sm border-2 border-citrus-sage/40 rounded-tl-none text-citrus-forest'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {isLoading && (
                  <div className="flex gap-2">
                    <Avatar className="h-8 w-8 border-2 border-citrus-sage bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/20 shadow-sm shrink-0">
                      <AvatarFallback className="bg-transparent">
                        <Narwhal className="h-4 w-4 text-citrus-forest" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="p-3 rounded-2xl rounded-tl-none border-2 border-citrus-sage/40 bg-[#E8EED9]/60 flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-citrus-sage" />
                      <span className="text-xs text-citrus-charcoal/60 font-display">Stormy is thinking...</span>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>

          {/* Input */}
          <CardFooter className="p-3 border-t-4 border-citrus-forest bg-[#E8EED9]/60 backdrop-blur-sm">
            <form
              className="flex w-full items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <Input
                placeholder="Ask Stormy..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="flex-1 rounded-xl border-2 border-citrus-sage/40 bg-[#E8EED9]/60 backdrop-blur-sm/50 text-citrus-forest placeholder:text-citrus-charcoal/50 font-display focus:border-citrus-orange transition-all"
                autoFocus
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputValue.trim() || isLoading}
                className="bg-gradient-to-br from-citrus-sage to-citrus-orange border-3 border-citrus-forest rounded-varsity shadow-patch hover:-translate-y-0.5 transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 text-[#E8EED9] animate-spin" />
                ) : (
                  <Send className="h-4 w-4 text-[#E8EED9]" />
                )}
              </Button>
            </form>
          </CardFooter>
        </>
      )}
    </Card>
  );
};
