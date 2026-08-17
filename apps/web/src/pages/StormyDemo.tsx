/**
 * StormyDemo — full-page Stormy chat for marketing/demo recordings.
 *
 * Forces fetchLeagueContext to point at a fantasy-pool league regardless
 * of the user's currently-active league (which may be in playoff-pool
 * mode where free-agent / lineup-move questions don't apply). Defaults
 * to the public read-only demo league; ?leagueId= overrides for any
 * league the user has access to.
 *
 * UX is recording-optimized: tight header, "Try asking" prompt grid that
 * collapses after the first message so the chat fills the screen, and
 * preset prompts curated to exercise the world-class features (xG/60
 * sustainability, GSAx goalie comparison, lineup optimization, sell-high
 * trade ideas, schedule advantage).
 */

import { userMessage } from '@/lib/userMessage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Send, RotateCcw, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { MascotAvatar } from '@/components/citrus2';
import {
  StormyService,
  fetchLeagueContext,
  type StormyContext,
  type StormyMessage,
} from '@/services/StormyService';
import { DEMO_LEAGUE_ID_FOR_GUESTS } from '@/services/DemoLeagueService';
import { leagueApi } from '@/api/leagues';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'stormy';
  timestamp: Date;
}

// Curated prompts that exercise the world-class features Stormy can now show
// off: xG/60 sustainability calls, GSAx goalie context, schedule advantage,
// roster-aware comparisons, sell-high trade framing.
const PRESET_PROMPTS: Array<{ category: string; prompts: string[] }> = [
  {
    category: 'Start / Sit',
    prompts: [
      "Who should I start tonight from my forwards? Cite xG/60 in your call.",
      "Is anyone on my roster on a hot streak that's not sustainable?",
      "Compare my two best skaters this week — who scores more given the schedule?",
    ],
  },
  {
    category: 'Free Agents / Pickups',
    prompts: [
      "Top free agent pickup based on my roster weaknesses — name them and the swap.",
      "Any low-rostered skater whose xG/60 says they're about to heat up?",
      "Which goalie should I stream this week given GSAx and schedule?",
    ],
  },
  {
    category: 'Trade Analysis',
    prompts: [
      "Which player on my roster is overperforming xG and I should sell high?",
      "What position do I need to upgrade most? Suggest a target.",
    ],
  },
  {
    category: 'Lineup Optimization',
    prompts: [
      "What's my optimal lineup for this week? List start/sit by position.",
      "Anyone on my bench who has more games this week than my starters?",
      "Goalie call this week — who do I start and why?",
    ],
  },
  {
    category: 'How am I doing?',
    prompts: [
      "Walk me through my matchup — am I favored, and what's the swing factor?",
      "Where am I in the standings and what should I focus on this week?",
      "What's my biggest roster weakness right now?",
    ],
  },
];

export default function StormyDemo() {
  const navigate = useNavigate();
  const auth = useAuth();
  const userId = auth?.user?.id;
  const [searchParams] = useSearchParams();

  // The user can override via ?leagueId=... in the URL. Otherwise we
  // auto-pick one of their own leagues (so the roster context actually
  // loads), falling back to the public demo league if they don't own
  // any. The selected league is reactive so the in-page dropdown can
  // switch between leagues without a navigation.
  const overrideLeagueId = searchParams.get('leagueId');
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>(
    overrideLeagueId || DEMO_LEAGUE_ID_FOR_GUESTS,
  );
  const [userLeagues, setUserLeagues] = useState<Array<{ id: string; name: string }>>([]);

  const initialGreeting =
    "Hey! I'm Stormy — your AI Assistant GM. I'm plugged into your roster, matchup, scoring, and the latest xG model. Ask me anything about start/sit, free agents, trades, or your matchup outlook.";

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'greet', text: initialGreeting, sender: 'stormy', timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  // Once a real conversation has started, collapse the preset grid so the
  // chat fills the screen for recording. The user can re-expand any time.
  const [presetsExpanded, setPresetsExpanded] = useState(true);

  const apiHistoryRef = useRef<StormyMessage[]>([]);
  const ctxRef = useRef<Partial<StormyContext> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the user's actual leagues once. If they have any, default the
  // selection to the first one (so context loads correctly) instead of
  // sticking with the public demo league which they don't own.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await leagueApi.getUserLeagues();
        if (cancelled) return;
        const list = ((res?.data ?? []) as Array<{ id: string; name?: string }>)
          .filter((l) => l?.id)
          .map((l) => ({ id: l.id, name: l.name ?? 'League' }));
        setUserLeagues(list);
        // If no ?leagueId override and the user owns at least one league,
        // auto-switch to their first league so we don't get the empty-
        // context experience on the public demo.
        if (!overrideLeagueId && list.length > 0) {
          setSelectedLeagueId(list[0].id);
        }
      } catch {
        // If listing fails we just stay on the demo default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, overrideLeagueId]);

  // Re-fetch context whenever the selected league changes.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setContextLoaded(false);
    setContextError(null);
    ctxRef.current = null;
    (async () => {
      try {
        const ctx = await fetchLeagueContext(selectedLeagueId, userId);
        if (cancelled) return;
        ctxRef.current = ctx;
        // If the lookup didn't find a team for this user (no ownership),
        // surface that explicitly — otherwise Stormy answers based on
        // empty context which is what produced "without seeing your full
        // roster status…" replies.
        if (!ctx.teamName && !ctx.rosterSummary) {
          setContextError(
            "Couldn't find your team in this league — pick one of your own leagues from the dropdown above for full roster context.",
          );
        }
        setContextLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setContextError(userMessage(err, 'Failed to load league'));
          setContextLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedLeagueId, userId]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const reset = useCallback(() => {
    apiHistoryRef.current = [];
    setMessages([
      { id: 'reset-' + Date.now(), text: initialGreeting, sender: 'stormy', timestamp: new Date() },
    ]);
    setPresetsExpanded(true);
  }, [initialGreeting]);

  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || isLoading || !contextLoaded) return;

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        text,
        sender: 'user',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);
      setPresetsExpanded(false);
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
              <CardTitle>Stormy</CardTitle>
              <CardDescription>Sign in to chat with your AI Assistant GM.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/auth')}>Sign in</Button>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  // Has the user actually started chatting? Used to switch the layout from
  // "showcase + chat" to "chat-first" once they engage.
  const hasUserSent = apiHistoryRef.current.length > 0;
  const teamName = ctxRef.current?.teamName;
  const leagueName = ctxRef.current?.leagueName;

  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-20 pb-6 px-3 sm:px-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Compact header — keeps the chat above the fold on phones */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="font-calistoga text-lg sm:text-xl text-pastel-cream flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-pastel-orange shrink-0" />
                Stormy
              </h1>
              {(teamName || leagueName) && (
                <p className="text-[11px] sm:text-xs text-white/55 mt-0.5 truncate">
                  {teamName ? <span className="text-pastel-cream/80">{teamName}</span> : null}
                  {teamName && leagueName ? ' · ' : ''}
                  {leagueName ?? ''}
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={reset} disabled={isLoading} className="shrink-0">
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              New chat
            </Button>
          </div>

          {/* League picker — visible only when the user owns at least one
              league, so they can swap between leagues for different demos
              without leaving the page. The public demo league is appended
              as a fallback option. */}
          {userLeagues.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs font-jbmono uppercase tracking-[0.22em] text-white/45 shrink-0">
                League
              </span>
              <Select
                value={selectedLeagueId}
                onValueChange={(v) => {
                  apiHistoryRef.current = [];
                  setSelectedLeagueId(v);
                  setMessages([
                    { id: 'switch-' + Date.now(), text: initialGreeting, sender: 'stormy', timestamp: new Date() },
                  ]);
                  setPresetsExpanded(true);
                }}
              >
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {userLeagues.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">
                      {l.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={DEMO_LEAGUE_ID_FOR_GUESTS} className="text-xs">
                    Public demo league
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {contextError && (
            <Card className="border-red-400/40">
              <CardContent className="py-3 text-sm text-red-300">
                Couldn't load your league: {contextError}
              </CardContent>
            </Card>
          )}

          {/* Try-asking grid. Always visible before first send. After first
              send, it collapses to a single tappable summary so the chat
              dominates the screen — re-expandable any time. */}
          {presetsExpanded ? (
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-xs font-jbmono uppercase tracking-[0.22em] text-pastel-orange-soft">
                    Try asking
                  </CardTitle>
                  <CardDescription className="text-[11px] mt-0.5">
                    Tap a question to start, or type your own.
                  </CardDescription>
                </div>
                {hasUserSent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPresetsExpanded(false)}
                    className="text-white/55 hover:text-pastel-cream h-7 px-2"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {PRESET_PROMPTS.map((group) => (
                  <div key={group.category}>
                    <div className="text-[9px] font-jbmono uppercase tracking-[0.22em] text-white/45 mb-1">
                      {group.category}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.prompts.map((p) => (
                        <Button
                          key={p}
                          size="sm"
                          variant="outline"
                          className="text-[11px] h-auto py-1 px-2 whitespace-normal text-left max-w-full leading-snug"
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
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center text-xs text-white/55 hover:text-pastel-cream h-8"
              onClick={() => setPresetsExpanded(true)}
            >
              <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
              Show suggested questions
            </Button>
          )}

          {/* Chat — taller when presets are collapsed so the messages get
              the full mobile viewport. */}
          <Card
            className={`flex flex-col ${
              presetsExpanded
                ? 'h-[calc(100dvh-22rem)] sm:h-[60vh] min-h-[280px]'
                : 'h-[calc(100dvh-9rem)] sm:h-[70vh] min-h-[400px]'
            }`}
          >
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full p-3 sm:p-4" ref={scrollRef}>
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
                        className={`max-w-[85%] p-2.5 sm:p-3 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
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
            <div className="p-2.5 sm:p-3 border-t border-white/10 flex gap-2">
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
