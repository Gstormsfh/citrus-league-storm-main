/**
 * OPENING NIGHT PICK'EM (2026-09-09): lead gen that does not need the app.
 *
 * Pick the winner of every opening-night game, leave an email, and you are on
 * the list with your picks attached (waitlist.metadata['opening-night-pickem']).
 * The date and the slate come from /api/public/schedule/opening-night, the
 * first day on or after today with scheduled games, so nothing here is typed
 * by hand; before the schedule loads the page is a plain email capture that
 * says picks open when the slate drops. Scoring is a spreadsheet job on the
 * morning after: this page only has to collect.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter, MascotAvatar, GlowCard, LivePulse } from '@/components/citrus2';
import { PressBoxTeamMark } from '@/components/pressbox/TeamMark';
import { publicApi } from '@/api/public';
import { WaitlistService } from '@/services/WaitlistService';
import { usePageMeta } from '@/lib/pageMeta';
import { readAcquisition } from '@/lib/acquisition';
import { getTeamColor } from '@/utils/teamColors';
import { cn } from '@/lib/utils';

interface Game {
  game_id: number;
  game_time: string | null;
  home_team: string;
  away_team: string;
  venue: string | null;
}

export const OPENING_NIGHT_SOURCE = 'opening-night-pickem';

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
}

function localTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function OpeningNight() {
  usePageMeta({
    title: "Opening Night Pick'em",
    description: 'Pick the winner of every NHL opening-night game. Free to enter.',
    path: '/opening-night',
  });

  const [date, setDate] = useState<string | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicApi
      .openingNight()
      .then((res) => {
        if (cancelled) return;
        setDate(res.data?.date ?? null);
        setGames(res.data?.games ?? []);
      })
      .catch(() => {
        /* the page still collects emails */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const picked = useMemo(() => games.filter((g) => picks[g.game_id]).length, [games, picks]);
  const slateReady = !!date && games.length > 0;
  const canSubmit = status !== 'sending' && email.trim().length > 3 && (!slateReady || picked === games.length);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('sending');
    setMessage(null);
    const metadata = slateReady
      ? { date, picks: games.map((g) => ({ game_id: g.game_id, away: g.away_team, home: g.home_team, pick: picks[g.game_id] })) }
      : { date: null, picks: [] as unknown[], note: 'entered before the slate was published' };
    const acquisition = readAcquisition();
    const result = await WaitlistService.addToWaitlist(email, OPENING_NIGHT_SOURCE, acquisition ? { ...metadata, acquisition } : metadata);
    setMessage(result.message);
    setStatus(result.success ? 'done' : 'error');
  };

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative pt-24 pb-20">
        <section className="max-w-[1100px] mx-auto px-6 py-12 md:py-16">
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex justify-center mb-6">
              <MascotAvatar id="stormy" size="xl" />
            </div>
            <div className="inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30">
              <LivePulse size="xs" />
              <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
                Free to enter · No app needed
              </span>
            </div>
            <h1 className="font-condensed font-extrabold uppercase text-[2.6rem] md:text-[4rem] leading-[0.95] tracking-[-0.01em] text-pressbox-text mb-5">
              Opening Night <span className="text-pressbox-orange">Pick'em</span>
            </h1>
            <p className="font-barlow font-normal text-[17px] md:text-[19px] leading-relaxed text-pressbox-text/75 max-w-xl mx-auto mb-3">
              Call the winner of every game on the NHL's opening night. Perfect slate takes the bragging rights;
              everyone who enters is first in line the hour Citrus goes live.
            </p>
            {slateReady ? (
              <p className="text-[14px] text-pressbox-text/60">{longDate(date as string)} · {games.length} games</p>
            ) : (
              !loading && <p className="text-[14px] text-pressbox-text/60">The slate is not published yet. Leave your email and we will send it to you the day it drops.</p>
            )}
          </div>

          <form onSubmit={submit} className="max-w-2xl mx-auto mt-10" data-testid="opening-night-form">
            {loading && (
              <div className="flex justify-center py-10" role="status" aria-label="Loading the slate">
                <Loader2 className="h-6 w-6 animate-spin text-pastel-orange" aria-hidden="true" />
              </div>
            )}

            {slateReady && (
              <ol className="space-y-3" data-testid="opening-night-games">
                {games.map((g) => (
                  <li key={g.game_id} className="rounded-2xl bg-[#1A2A20] ring-1 ring-white/10 p-3 md:p-4">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <TeamPick team={g.away_team} selected={picks[g.game_id] === g.away_team} onPick={() => setPicks((p) => ({ ...p, [g.game_id]: g.away_team }))} />
                      <span className="font-jbmono text-[10px] tracking-[0.18em] uppercase text-pressbox-text/60 px-1 text-center">
                        {localTime(g.game_time) ?? 'TBD'}
                      </span>
                      <TeamPick team={g.home_team} selected={picks[g.game_id] === g.home_team} onPick={() => setPicks((p) => ({ ...p, [g.game_id]: g.home_team }))} home />
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="mt-8">
              <GlowCard accent="orange">
                <div className="p-6 md:p-8">
                  {status === 'done' ? (
                    <div className="text-center" role="status">
                      <p className="font-condensed font-extrabold uppercase text-[1.4rem] text-pastel-cream mb-2">You're in.</p>
                      <p className="text-[14px] text-pressbox-text/70 mb-6">{message}</p>
                      <Link to="/features" className="inline-flex items-center gap-2 text-pastel-orange font-bold">
                        See what Citrus does <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  ) : (
                    <>
                      {slateReady && (
                        <p className="font-jbmono text-[11px] tracking-[0.18em] uppercase text-pressbox-text/60 mb-3" data-testid="opening-night-progress">
                          {picked} of {games.length} picked
                        </p>
                      )}
                      <label htmlFor="opening-night-email" className="block text-[13px] text-pressbox-text/70 mb-2">
                        Where should we send the results and your launch invite?
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          id="opening-night-email"
                          type="email"
                          required
                          autoComplete="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="flex-1 h-12 rounded-xl bg-white/5 border border-white/10 px-4 text-pastel-cream placeholder:text-pressbox-text/60 focus:outline-none focus:ring-2 focus:ring-pastel-orange/40"
                        />
                        <button
                          type="submit"
                          disabled={!canSubmit}
                          className="h-12 px-6 rounded-xl bg-pastel-orange text-[#581E00] font-bold disabled:opacity-40"
                        >
                          {status === 'sending' ? 'Sending' : slateReady ? 'Lock my picks' : 'Notify me'}
                        </button>
                      </div>
                      {status === 'error' && message && (
                        <p role="alert" className="mt-3 text-sm text-red-300">{message}</p>
                      )}
                      <p className="mt-3 text-[12px] text-pressbox-text/60">No spam. Results after the games, one launch email, that's it.</p>
                    </>
                  )}
                </div>
              </GlowCard>
            </div>
          </form>
        </section>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
}

function TeamPick({ team, selected, onPick, home = false }: { team: string; selected: boolean; onPick: () => void; home?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={`Pick ${team}`}
      className={cn(
        'focus-citrus flex items-center gap-3 rounded-xl px-3 py-3 border transition-colors',
        home ? 'flex-row-reverse text-right' : '',
        selected ? 'border-pastel-orange bg-pastel-orange/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
      )}
      style={selected ? { boxShadow: `inset 0 0 0 1px ${getTeamColor(team)}` } : undefined}
    >
      <PressBoxTeamMark abbrev={team} size="md" />
      <span className="font-display font-bold text-pastel-cream">{team}</span>
    </button>
  );
}
