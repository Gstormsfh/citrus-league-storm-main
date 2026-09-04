import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Send, Minimize2, Maximize2, Loader2 } from 'lucide-react';
import { Narwhal } from '@/components/icons/Narwhal';
import { MascotAvatar } from '@/components/citrus2';
import { StormyService, fetchLeagueContext, type StormyMessage, type StormyContext } from '@/services/StormyService';
import { useLeague } from '@/contexts/LeagueContext';
import { useAuth } from '@/contexts/AuthContext';
import { ChatBar } from '@/components/pressbox/ChatBar';

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

/**
 * PRESS BOX (2026-09-04): the one line the phone's Stormy bar carries —
 * short enough to survive a 40px bar beside the mascot and never wrap. The
 * greeting below is what the open panel still says first.
 */
const getContextNudge = (pathname: string): string => {
  if (pathname.includes('/roster')) return 'Start/sit help? Ask me';
  if (pathname.includes('/trade-analyzer')) return 'I can weigh both sides of a trade';
  if (pathname.includes('/free-agents')) return "Ask who's about to heat up";
  if (pathname.includes('/matchup')) return 'Ask me your win chance this week';
  if (pathname.includes('/team-analytics')) return 'Ask where your lineup is weakest';
  if (pathname.includes('/standings')) return 'Ask me about playoff scenarios';
  if (pathname.includes('/waiver-wire')) return 'Ask me who to claim';
  return 'Ask me about a start/sit, a trade or a pickup';
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
  return "Stormy here. Your roster, your scoring settings and your matchup are already loaded. Ask me about a start/sit, a trade, or a waiver target.";
};

// ── Types ────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

// ── Component ────────────────────────────────────────────────────

/**
 * True while the user is typing into a form field anywhere on the page.
 *
 * The FAB is `position: fixed` at the bottom-left with z-index 100, so it sits
 * on top of whatever the page has in that corner. On list screens that is
 * harmless — the 2026-08-23 mobile fix moved it left precisely because the
 * right side was eating the Free Agents "+" buttons, and the left only covers
 * avatars. But that reasoning was about LISTS. On a FORM the left edge is
 * where every input starts, so a 56px opaque circle lands squarely on top of
 * one: on Profile it covers the first characters of "Confirm new password".
 *
 * Moving it back to the right just relocates the collision. Instead the FAB
 * gets out of the way while a field has focus and comes back on blur — which
 * also matches what it should do on mobile when the keyboard is up.
 *
 * Listens on the document rather than per-field so this holds for every form
 * in the app, including ones written later. focusout is deferred a tick
 * because activeElement is momentarily <body> between two fields, and without
 * that the FAB flashes back while tabbing.
 */
function useTextFieldFocused(): boolean {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const NON_TEXT_INPUTS = new Set([
      'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image',
    ]);

    const isTextEntry = (el: Element | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      // isContentEditable is the correct API — it accounts for the attribute
      // being inherited from an ancestor. The attribute check beside it covers
      // environments that do not implement the property (jsdom is one, which
      // is why the attribute path is the one under test).
      if (el.isContentEditable) return true;
      const editable = el.getAttribute('contenteditable');
      if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName !== 'INPUT') return false;
      return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
    };

    const update = () => setFocused(isTextEntry(document.activeElement));
    const onFocusOut = () => window.setTimeout(update, 0);

    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    update();

    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return focused;
}

export const StormyChatBubble = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  // Only consulted for the closed FAB below. The open chat card must never
  // hide itself when its OWN input takes focus.
  const textFieldFocused = useTextFieldFocused();
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
          text: "That one didn't get through. Give me a second and ask again.",
          sender: 'stormy',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, buildContext]);

  // ── Draft rooms: stand down ────────────────────────────────────
  //
  // MOBILE PASS (2026-09-01, iPhone 17 Pro sim): the FAB is a fixed
  // 56px circle at the bottom-LEFT (moved there 2026-08-23 because the
  // right edge ate row actions) — and in the draft room the bottom-left
  // is the player list. Screenshotted sitting directly on top of pool
  // rows while the founder was trying to pick under a live clock.
  //
  // A draft is the one screen where a misclick has a shot clock, the
  // screen real-estate budget is zero, and the on-clock action bar now
  // owns the bottom edge (DraftRoomV2 MainTabs). Stormy stays reachable
  // everywhere else; an in-room draft copilot is a designed surface for
  // later (integrated panel, not a floating circle over the pool).
  // Placed after every hook call — rules of hooks — and before either
  // render branch so both the FAB and the open card stand down.
  if (/^\/(draft|draft-v2|draft-room)(\/|$)/.test(location.pathname)) {
    return null;
  }

  // ── Closed State (FAB) ─────────────────────────────────────────

  /**
   * PRESS BOX (2026-09-04): on a phone the closed state is the Stormy BAR
   * above the bottom nav — artboard 1a draws it on every league screen —
   * not a floating orange circle over the page's rows. The bar and the nav
   * are one strip of fixed chrome (`.pb-app-chrome` reserves the room), so
   * it stands down wherever the nav does: the auth and setup routes, and
   * the draft rooms handled above. Desktop keeps the FAB.
   */
  if (!isOpen && isMobile) {
    const navHidden = ['/auth', '/profile-setup', '/verify-email', '/reset-password'].some((r) =>
      location.pathname.startsWith(r),
    );
    if (navHidden || textFieldFocused) return null;
    return (
      <ChatBar
        variant="stormy"
        message={getContextNudge(location.pathname)}
        onPress={() => setIsOpen(true)}
      />
    );
  }

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed h-14 w-14 rounded-full bg-pastel-orange ring-2 ring-pastel-orange/30 shadow-[0_24px_60px_-20px_rgba(255,107,26,0.4)] hover:scale-105 hover:-translate-y-1 transition-all z-overlay p-0 overflow-hidden"
        style={{
          position: 'fixed',
          bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom) + 4rem)' : '1.5rem',
          // MOBILE FIX (2026-08-23, found in the 390px sweep): on the RIGHT
          // edge the FAB sat directly on top of right-aligned row actions —
          // the Free Agents "+" add buttons and Trade Center info buttons —
          // so taps meant for those controls hit Stormy instead. Left side
          // only overlaps avatars/names (which open the player card), the
          // least destructive collision. Desktop already lives bottom-left.
          left: isMobile ? '1rem' : '1.5rem',
          right: 'auto',
          zIndex: 100,
          opacity: textFieldFocused ? 0 : 1,
          pointerEvents: textFieldFocused ? 'none' : 'auto',
        }}
        // Icon-only control: without this it announces as an unnamed button.
        aria-label="Ask Stormy"
        data-testid="stormy-fab"
        aria-hidden={textFieldFocused}
        tabIndex={textFieldFocused ? -1 : 0}
      >
        <Narwhal className="h-7 w-7 text-pastel-cream relative z-10 pointer-events-none" />
        <span className="absolute -top-1 -right-1 h-3 w-3 bg-pastel-sage rounded-full ring-2 ring-pastel-surface animate-pulse pointer-events-none" />
      </Button>
    );
  }

  // ── Open State (Chat Card) ─────────────────────────────────────

  return (
    <Card
      className={`fixed w-[calc(100vw-3rem)] md:w-[440px] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10 border-0 rounded-2xl overflow-hidden flex flex-col transition-all duration-300 bg-pastel-surface-tile ${isMinimized ? 'h-[70px]' : 'h-[min(640px,80vh)]'}`}
      style={{
        position: 'fixed',
        bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom) + 4rem)' : '1.5rem',
        right: isMobile ? '1rem' : 'auto',
        left: isMobile ? 'auto' : '1.5rem',
        zIndex: 100,
      }}
    >
      {/* Header */}
      <CardHeader className="p-4 border-b border-white/10 flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <MascotAvatar id="stormy" size="md" ring />
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-pastel-sage rounded-full ring-2 ring-pastel-surface-tile animate-pulse" />
          </div>
          <div>
            <CardTitle className="text-base font-calistoga text-pastel-cream">
              Stormy
            </CardTitle>
            <p className="text-pastel-orange-soft font-jbmono text-[10px] tracking-[0.22em] uppercase font-bold">
              {isLoading ? 'Thinking...' : 'Powered by Claude'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/55 hover:text-pastel-cream hover:bg-white/5" onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/55 hover:text-pastel-cream hover:bg-white/5" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {/* Chat Body */}
      {!isMinimized && (
        <>
          <CardContent className="flex-1 p-0 overflow-hidden bg-pastel-surface-tile relative">
            <ScrollArea className="h-full p-4" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {msg.sender === 'stormy' && (
                      <MascotAvatar id="stormy" size="sm" ring className="shrink-0" />
                    )}
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl text-sm shadow-sm whitespace-pre-wrap ${
                        msg.sender === 'user'
                          ? 'bg-pastel-orange text-[#0F1F15] font-bold rounded-tr-none'
                          : 'bg-white/5 border border-white/10 text-pastel-cream rounded-tl-none'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {isLoading && (
                  <div className="flex gap-2">
                    <MascotAvatar id="stormy" size="sm" ring className="shrink-0" />
                    <div className="p-3 rounded-2xl rounded-tl-none border border-white/10 bg-white/5 flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-pastel-orange-soft" />
                      <span className="text-white/55 font-jbmono text-[10px] tracking-[0.22em] uppercase">Stormy is thinking...</span>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>

          {/* Input */}
          <CardFooter className="p-3 border-t border-white/10 bg-pastel-surface-tile">
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
                className="flex-1"
                autoFocus
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputValue.trim() || isLoading}
                className="bg-pastel-orange hover:bg-pastel-orange-soft text-[#0F1F15] rounded-md hover:-translate-y-0.5 transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 text-[#0F1F15] animate-spin" />
                ) : (
                  <Send className="h-4 w-4 text-[#0F1F15]" />
                )}
              </Button>
            </form>
          </CardFooter>
        </>
      )}
    </Card>
  );
};
