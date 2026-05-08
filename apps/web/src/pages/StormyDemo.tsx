/**
 * StormyDemo — admin/recording page that lets you exercise Stormy's
 * regular-season fantasy features (free agent pickups, lineup decisions,
 * trade analysis) even when your active league is in playoff-pool mode.
 *
 * It does this by manually pointing fetchLeagueContext at the demo
 * league (DEMO_LEAGUE_ID_FOR_GUESTS), which has a real fantasy roster +
 * matchup + standings + free agents already populated.
 *
 * Includes a row of preset prompt buttons that auto-fill the input —
 * useful for clean demo recordings.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Send, RotateCcw, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { MascotAvatar } from '@/components/citrus2';
import {
  StormyService,
  fetchLeagueContext,
  type StormyContext,
  type StormyMessage,
} from '@/services/StormyService';
import { DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

// Preset prompts that show off the world-class features. Click to autofill.
// Grouped by category so you can record one at a time cleanly.
const PRESET_PROMPTS: Array<{ category: string; prompts: string[] }> = [
  {
    category: 'Start / Sit',
    prompts: [
      'Who should I start tonight from my forwards?',
      'Should I sit anyone with a tough matchup this week?',
      'Compare my two best skaters this week — who scores more?',
    ],
  },
  {
    category: 'Free Agents / Pickups',
    prompts: [
      'Who should I pick up from free agents?',
      'Top waiver wire pickup based on my roster weaknesses?',
      'Any low-rostered hot players I should grab?',
    ],
  },
  {
    category: 'Trade Analysis',
    prompts: [
      'Walk me through a trade idea: which of my players is overperforming and could be sold high?',
      'What player would help my roster the most right now?',
    ],
  },
  {
    category: 'Lineup Optimization',
    prompts: [
      "What's my optimal lineup for this week?",
      'Anyone on my bench who should be starting based on this week\'s schedule?',
      'How many games does each of my players have this week?',
    ],
  },
  {
    category: 'How am I doing?',
    prompts: [
      'How does my matchup look this week — am I favored?',
      'Where am I in the standings and what should I focus on?',
      'What\'s my biggest weakness right now?',
    ],
  },
];

export default function StormyDemo() {
  const navigate = useNavigate();
  const auth = useAuth();
  const userId = auth?.user?.id;
  const [searchParams] = useSearchParams();

  // Allow override via ?leagueId= for testing custom leagues.
  const leagueId = searchParams.get('leagueId') || DEMO_LEAGUE_ID_FOR_GUESTS;

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'greet',
      text:
        "Hey! I'm Stormy — your AI Assistant GM. I'm plugged into your roster, matchup, scoring, and the latest xG model. Ask me anything about start/sit, free agents, trades, or your matchup outlook.",
      sender: 'stormy',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const apiHistoryRef = useRef<StormyMessage[]>([]);
  const ctxRef = useRef<Partial<StormyContext> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Lazy-load the demo league context once.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const ctx = await fetchLeagueContext(leagueId, userId);
        if (cancelled) return;
        ctxRef.current = ctx;
        setContextLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setContextError(err instanceof Error ? err.message : 'Failed to load demo context');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, userId]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const reset = useCallback(() => {
    apiHistoryRef.current = [];
    setMessages([
      {
        id: 'reset-' + Date.now(),
        text:
          "Hey! I'm Stormy — your AI Assistant GM. I'm plugged into your roster, matchup, scoring, and the latest xG model. Ask me anything about start/sit, free agents, trades, or your matchup outlook.",
        sender: 'stormy',
        timestamp: new Date(),
      },
    ]);
  }, []);

  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || isLoading) return;
      if (!contextLoaded) return;

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        text,
        sender: 'user',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);
      apiHistoryRef.current.push({ role: 'user', content: text });

      const stormyId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: stormyId, text: '', sender: 'stormy', timestamp: new Date() },
      ]);

      const ctx: StormyContext = {
        page: 'GM Office',
        leagueName: ctxRef.current?.leagueName,
        teamName: ctxRef.current?.teamName,
        scoringSettings: ctxRef.current?.scoringSettings,
        rosterSummary: ctxRef.current?.rosterSummary,
        matchupSummary: ctxRef.current?.matchupSummary,
        standingsSummary: ctxRef.current?.standingsSummary,
        extra: ctxRef.current?.extra,
      };

      try {
        const result = await StormyService.sendMessageStream(
          text,
          apiHistoryRef.current.slice(0, -1),
          ctx,
          (delta) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === stormyId ? { ...m, text: m.text + delta } : m)),
            );
          },
        );
        if (result.error) {
          setMessages((prev) =>
            prev.map((m) => (m.id === stormyId ? { ...m, text: result.error! } : m)),
          );
        } else {
          apiHistoryRef.current.push({ role: 'assistant', content: result.response });
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === stormyId
              ? { ...m, text: 'Something went wrong — give me a sec and try again.' }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [input, isLoading, contextLoaded],
  );

  if (!userId) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen pt-24 pb-16 px-4 max-w-3xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Stormy Demo</CardTitle>
              <CardDescription>You need to be signed in to use the demo.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/auth')}>Sign in</Button>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 pb-16 px-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="font-calistoga text-2xl text-pastel-cream flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-pastel-orange" />
                Stormy — Assistant GM
              </h1>
              <p className="text-sm text-white/60 mt-1">
                Live access to your roster, matchup, projections, and xG model.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset} disabled={isLoading}>
              <RotateCcw className="h-4 w-4 mr-1" />
              New chat
            </Button>
          </div>

          {contextError && (
            <Card className="border-red-400/40">
              <CardContent className="py-3 text-sm text-red-300">
                Demo context failed to load: {contextError}
              </CardContent>
            </Card>
          )}

          {/* Quick prompt grid — visible until the first message is sent */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft">
                Try asking
              </CardTitle>
              <CardDescription className="text-xs">
                Tap any question to start, or type your own.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {PRESET_PROMPTS.map((group) => (
                <div key={group.category}>
                  <div className="text-[10px] font-jbmono uppercase tracking-[0.22em] text-white/45 mb-1.5">
                    {group.category}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.prompts.map((p) => (
                      <Button
                        key={p}
                        size="sm"
                        variant="outline"
                        className="text-xs h-auto py-1.5 px-2 whitespace-normal text-left max-w-full"
                        disabled={!contextLoaded || isLoading}
                        onClick={() => handleSend(p)}
                      >
                        {p}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Chat */}
          <Card className="h-[60vh] flex flex-col">
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full p-4" ref={scrollRef}>
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex gap-2 ${m.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {m.sender === 'stormy' && (
                        <MascotAvatar id="stormy" size="sm" ring className="shrink-0" />
                      )}
                      <div
                        className={`max-w-[80%] p-3 rounded-2xl text-sm whitespace-pre-wrap ${
                          m.sender === 'user'
                            ? 'bg-pastel-orange text-[#0F1F15] font-bold rounded-tr-none'
                            : 'bg-white/5 border border-white/10 text-pastel-cream rounded-tl-none'
                        }`}
                      >
                        {m.text || (m.sender === 'stormy' && isLoading ? '…' : '')}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
            <div className="p-3 border-t border-white/10 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  contextLoaded ? 'Ask Stormy anything…' : 'Loading your league…'
                }
                disabled={!contextLoaded || isLoading}
                className="flex-1"
              />
              <Button
                onClick={() => handleSend()}
                disabled={!contextLoaded || isLoading || !input.trim()}
                size="icon"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
