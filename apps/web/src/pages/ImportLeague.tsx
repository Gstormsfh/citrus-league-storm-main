/**
 * IMPORT (2026-09-13): bring a league's history over from ESPN, Yahoo, or
 * anywhere at all.
 *
 * The rule this page is built around: no hoops. A public ESPN league is a
 * pasted link. Anything else is screenshots of the pages the league cares
 * about, read here and checked before they are written: Yahoo, Fantrax,
 * CBS, a spreadsheet, with no login of any kind (2026-09-14). Yahoo's
 * one-tap connection stays for when Yahoo approves it. A private ESPN
 * league gets the two honest ways forward (the commissioner makes it public
 * on ESPN, or the user signs in to ESPN here on the web); that sign-in is
 * web only, so the iOS build says "finish on the web" rather than asking
 * for a credential the App Store does not allow it to.
 *
 * The history attaches to a Citrus league the user commissions. With none,
 * the door is Create league; the import is one step after.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useLeague } from '@/contexts/LeagueContext';
import { importApi, type EspnCredentials, type EspnDiscovery, type ImportJob, type YahooChain, type YahooConnection } from '@/api/imports';
import Navbar from '@/components/Navbar';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { ImportProgress } from '@/components/history/ImportProgress';
import { ScreenshotImport } from '@/components/history/screenshots/ScreenshotImport';
import { seasonLabel } from '@/components/history/trophyLabels';
import { Chip, Eyebrow, HistoryButton, Panel, inputClass } from '@/components/history/ui';
import { isNativeShell } from '@/lib/nativeAuth';
import { usePageMeta } from '@/lib/pageMeta';
import { useToast } from '@/hooks/use-toast';

const dataOf = <T,>(res: unknown): T | null => ((res as { data?: T })?.data ?? null);
const SCORING_LABEL: Record<string, string> = { h2h_points: 'H2H points', h2h_categories: 'H2H categories', h2h_one_win: 'H2H categories', roto: 'Rotisserie', points: 'Total points', unknown: 'Custom' };

export default function ImportLeague() {
  usePageMeta({ title: 'Bring your league', description: 'Import every season, champion and record from Yahoo, ESPN, Fantrax or anywhere into Citrus.', path: '/import' });
  const { user } = useAuth();
  const league = useLeague();
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const native = isNativeShell();

  const commissioned = useMemo(() => (league?.userLeagues ?? []).filter((l) => l.commissioner_id === user?.id), [league?.userLeagues, user?.id]);
  const [targetId, setTargetId] = useState<string>(params.get('league') ?? '');
  useEffect(() => {
    if (!targetId && commissioned.length === 1) setTargetId(commissioned[0].id);
  }, [commissioned, targetId]);
  const target = commissioned.find((l) => l.id === targetId) ?? null;

  const [job, setJob] = useState<ImportJob | null>(null);

  // ---- ESPN -----------------------------------------------------------------
  const [espnLink, setEspnLink] = useState('');
  const [discovery, setDiscovery] = useState<EspnDiscovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [espnS2, setEspnS2] = useState('');
  const [swid, setSwid] = useState('');
  const [showSignIn, setShowSignIn] = useState(false);
  const creds: EspnCredentials | undefined = espnS2.trim().length >= 20 ? { espnS2: espnS2.trim(), ...(swid.trim() ? { swid: swid.trim() } : {}) } : undefined;

  const findEspn = async () => {
    if (!espnLink.trim()) return;
    setDiscovering(true);
    setDiscovery(null);
    try {
      const d = dataOf<EspnDiscovery>(await importApi.discoverEspn(espnLink.trim(), creds));
      setDiscovery(d);
      if (d?.needsCredentials && !native) setShowSignIn(true);
    } catch (e) {
      toast({ title: "Couldn't reach ESPN", description: (e as Error).message || 'Check the link and try again.' });
    } finally {
      setDiscovering(false);
    }
  };

  const startEspn = async () => {
    if (!discovery || !target) return;
    try {
      const j = dataOf<ImportJob>(await importApi.startEspn(target.id, { externalLeagueId: discovery.externalLeagueId, latestEspnSeason: discovery.latestEspnSeason, credentials: creds }));
      if (j) setJob(j);
    } catch (e) {
      toast({ title: "Import didn't start", description: (e as Error).message });
    }
  };

  // ---- Yahoo ----------------------------------------------------------------
  const connection = useQuery({
    queryKey: ['yahoo-connection'],
    enabled: !!user,
    queryFn: async () => dataOf<YahooConnection>(await importApi.yahooConnection()),
  });
  const yahooLeagues = useQuery({
    queryKey: ['yahoo-leagues'],
    enabled: !!connection.data?.connected,
    staleTime: 5 * 60_000,
    queryFn: async () => dataOf<{ guid: string | null; chains: YahooChain[] }>(await importApi.yahooLeagues()),
  });
  useEffect(() => {
    if (params.get('yahoo') === 'connected') {
      toast({ title: 'Yahoo connected', description: 'Pick the league to bring over.' });
      params.delete('yahoo');
      setParams(params, { replace: true });
      void connection.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [connecting, setConnecting] = useState(false);
  const connectYahoo = async () => {
    setConnecting(true);
    try {
      const d = dataOf<{ url: string }>(await importApi.yahooConnectUrl());
      if (d?.url) window.location.assign(d.url);
    } catch (e) {
      toast({ title: "Couldn't start Yahoo sign-in", description: (e as Error).message });
      setConnecting(false);
    }
  };
  const startYahoo = async (chain: YahooChain) => {
    if (!target) return;
    try {
      const j = dataOf<ImportJob>(await importApi.startYahoo(target.id, { leagueKey: chain.key }));
      if (j) setJob(j);
    } catch (e) {
      toast({ title: "Import didn't start", description: (e as Error).message });
    }
  };

  const signInPanel = !native ? (
    <div data-testid="espn-signin">
      <p className="font-barlow text-[13px] leading-[1.45] text-white/60">
        Sign in to ESPN in another tab, then copy two cookies from your browser: <span className="font-plex">espn_s2</span> and <span className="font-plex">SWID</span>. They are used for this import only and are never stored.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="sr-only" htmlFor="espn-s2">espn_s2 cookie</label>
        <input id="espn-s2" value={espnS2} onChange={(e) => setEspnS2(e.target.value)} placeholder="espn_s2" className={inputClass} autoComplete="off" spellCheck={false} />
        <label className="sr-only" htmlFor="espn-swid">SWID cookie</label>
        <input id="espn-swid" value={swid} onChange={(e) => setSwid(e.target.value)} placeholder="SWID, like {1234ABCD-...}" className={inputClass} autoComplete="off" spellCheck={false} />
      </div>
      <p className="mt-1.5 font-barlow text-[12px] text-white/55">Your SWID is also how we know which team was yours, so your trophies attach to you on the spot.</p>
    </div>
  ) : (
    <p data-testid="espn-finish-on-web" className="font-barlow text-[13px] leading-[1.45] text-white/60">
      Finish this on the web at citrusfantasysports.com/import to bring private seasons over with your ESPN sign-in.
    </p>
  );

  return (
    <div className="min-h-screen bg-pressbox-surface text-pressbox-text flex flex-col">
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]">
        <PressBoxAppHeader title="Bring your league" logoSrc="/favicon.svg" />
      </div>
      <main className="pb-app-chrome lg:pt-app-header lg:pb-16">
        <div className="pb-type mx-auto w-full max-w-3xl px-3.5 pt-4 lg:px-6">
          <Eyebrow>✦ Bring your league</Eyebrow>
          <h1 className="mt-1 font-condensed font-extrabold text-[26px] uppercase tracking-[0.02em] leading-none text-pressbox-text">Every season. Every champion. Every record.</h1>
          <p className="mt-1.5 font-barlow text-[13px] leading-[1.45] text-white/55">
            Your league's past comes with you: standings, playoffs, drafts, keepers and the records they set, into a trophy room your managers can claim their own names in.
          </p>

          {/* ---- target league ---------------------------------------------- */}
          <Panel className="mt-4" testId="import-target">
            <Eyebrow>✦ Into which Citrus league?</Eyebrow>
            {league?.loading ? (
              <p className="mt-2 font-barlow text-[13px] text-white/55">Loading your leagues…</p>
            ) : commissioned.length === 0 ? (
              <div className="mt-2">
                <p className="font-barlow text-[13px] leading-[1.45] text-white/60">History attaches to a league you commission. Create yours first; this is one step after.</p>
                <Link to="/create-league" className="mt-3 inline-flex h-10 items-center rounded-[10px] bg-pressbox-orange px-4 font-condensed font-bold text-[14px] uppercase tracking-[0.06em] text-pressbox-orange-ink">Create your league</Link>
              </div>
            ) : (
              <div className="mt-2">
                <label className="sr-only" htmlFor="import-target-league">Citrus league</label>
                <select id="import-target-league" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputClass} disabled={!!job}>
                  <option value="" className="text-black">Choose a league</option>
                  {commissioned.map((l) => <option key={l.id} value={l.id} className="text-black">{l.name}</option>)}
                </select>
              </div>
            )}
          </Panel>

          {job && target && (
            <div className="mt-4">
              <ImportProgress leagueId={target.id} job={job} credentialsSlot={job.platform === 'espn' ? (
                <div>
                  {signInPanel}
                  {!native && creds && (
                    <HistoryButton className="mt-2" onClick={() => void startEspn()}>Import the rest</HistoryButton>
                  )}
                </div>
              ) : undefined} />
              <button type="button" onClick={() => setJob(null)} className="mt-2 font-barlow text-[13px] text-pressbox-orange-soft">Import another league</button>
            </div>
          )}

          {!job && (
            <div className="mt-4 space-y-4">
              {/* ---- ESPN ------------------------------------------------------ */}
              <Panel testId="import-espn">
                <Eyebrow>✦ ESPN</Eyebrow>
                <p className="mt-1 font-condensed font-bold text-[16px] text-pressbox-text">Paste your league link</p>
                <p className="mt-0.5 font-barlow text-[12px] text-white/50">Any page of your league on fantasy.espn.com, or the league id from its address.</p>
                <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void findEspn(); }}>
                  <label className="sr-only" htmlFor="espn-link">ESPN league link</label>
                  <input id="espn-link" value={espnLink} onChange={(e) => setEspnLink(e.target.value)} placeholder="https://fantasy.espn.com/hockey/league?leagueId=..." className={inputClass} autoComplete="off" spellCheck={false} />
                  <HistoryButton type="submit" busy={discovering} disabled={!espnLink.trim()}>{discovering ? 'Looking' : 'Find my league'}</HistoryButton>
                </form>

                {discovery && !discovery.needsCredentials && (
                  <div className="mt-3 rounded-[10px] bg-white/[0.04] px-3 py-2.5" data-testid="espn-found">
                    <p className="font-condensed font-bold text-[16px] text-pressbox-text">{discovery.leagueName || `League ${discovery.externalLeagueId}`}</p>
                    <p className="font-barlow text-[12px] text-white/55">
                      {[
                        discovery.seasons?.length ? `${discovery.seasons.length} ${discovery.seasons.length === 1 ? 'season' : 'seasons'} (${seasonLabel(discovery.seasons[0])} to ${seasonLabel(discovery.seasons[discovery.seasons.length - 1])})` : null,
                        discovery.teamCount ? `${discovery.teamCount} teams` : null,
                        discovery.scoringType ? SCORING_LABEL[discovery.scoringType] ?? discovery.scoringType : null,
                        discovery.isPublic === false ? 'private' : discovery.isPublic ? 'public' : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    {discovery.seasons && discovery.seasons.some((s) => s < 2018) && !creds && (
                      <p className="mt-1 font-barlow text-[12px] text-white/50">
                        ESPN keeps seasons before 2018-19 behind a login. Everything from 2018-19 on comes over now; {native ? 'finish on the web' : 'sign in below'} for the rest.
                      </p>
                    )}
                    {!native && discovery.seasons?.some((s) => s < 2018) && !showSignIn && (
                      <button type="button" onClick={() => setShowSignIn(true)} className="mt-1 font-barlow text-[13px] text-pressbox-orange-soft">Sign in to ESPN for the older seasons</button>
                    )}
                    {showSignIn && <div className="mt-2">{signInPanel}</div>}
                    <HistoryButton className="mt-3" disabled={!target} onClick={() => void startEspn()}>
                      {target ? `Import into ${target.name}` : 'Choose a Citrus league first'}
                    </HistoryButton>
                  </div>
                )}

                {discovery?.needsCredentials && (
                  <div className="mt-3 rounded-[10px] bg-white/[0.04] px-3 py-2.5" data-testid="espn-private">
                    <p className="font-condensed font-bold text-[16px] text-pressbox-text">This league is private on ESPN</p>
                    <p className="mt-0.5 font-barlow text-[13px] leading-[1.45] text-white/60">
                      Two ways in. Ask your commissioner to turn on <span className="text-pressbox-text/85">Make League Viewable to Public</span> in ESPN's league settings, then find it again. {native ? 'Or finish on the web with your ESPN sign-in.' : 'Or sign in to ESPN here.'}
                    </p>
                    <div className="mt-2">{signInPanel}</div>
                    {!native && (
                      <HistoryButton className="mt-2" disabled={!creds} busy={discovering} onClick={() => void findEspn()}>Find it with my sign-in</HistoryButton>
                    )}
                  </div>
                )}
              </Panel>

              {/* ---- Screenshots, any platform ---------------------------------- */}
              <Panel testId="import-screenshots">
                <Eyebrow>✦ Yahoo, Fantrax, CBS, anywhere</Eyebrow>
                <ScreenshotImport leagueId={target?.id ?? null} leagueName={target?.name ?? null} onJob={setJob} />
              </Panel>

              {/* ---- Yahoo ----------------------------------------------------- */}
              <Panel testId="import-yahoo">
                <Eyebrow>✦ Yahoo, one tap</Eyebrow>
                {connection.data && !connection.data.configured ? (
                  <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-white/60">A one-tap Yahoo connection is on its way. Until then, screenshots above bring a Yahoo league over today.</p>
                ) : native ? (
                  <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-white/60">Connect Yahoo on the web at citrusfantasysports.com/import; your leagues appear here once you have.</p>
                ) : !connection.data?.connected ? (
                  <div className="mt-1">
                    <p className="font-condensed font-bold text-[16px] text-pressbox-text">One tap. Your leagues appear.</p>
                    <p className="mt-0.5 font-barlow text-[12px] text-white/50">Read-only. We never post to Yahoo or change anything there, and you can disconnect any time.</p>
                    <HistoryButton className="mt-2" busy={connecting} onClick={() => void connectYahoo()}>Connect Yahoo</HistoryButton>
                  </div>
                ) : (
                  <div className="mt-1" data-testid="yahoo-leagues">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-condensed font-bold text-[16px] text-pressbox-text">Your NHL leagues on Yahoo</p>
                      <button type="button" className="font-barlow text-[12px] text-white/55" onClick={async () => { await importApi.yahooDisconnect(); void connection.refetch(); }}>Disconnect</button>
                    </div>
                    {yahooLeagues.isLoading && <p className="mt-1 font-barlow text-[13px] text-white/50">Reading your leagues from Yahoo…</p>}
                    {yahooLeagues.isError && <p role="alert" className="mt-1 font-barlow text-[13px] text-pressbox-grapefruit-text">{(yahooLeagues.error as Error).message}</p>}
                    {yahooLeagues.data && yahooLeagues.data.chains.length === 0 && (
                      <p className="mt-1 font-barlow text-[13px] text-white/50">No NHL leagues on this Yahoo account.</p>
                    )}
                    {(yahooLeagues.data?.chains ?? []).map((chain, i, arr) => (
                      <div key={chain.key} className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? 'border-b border-white/[0.06]' : ''}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-condensed font-bold text-[16px] text-pressbox-text">{chain.name}</span>
                          <span className="block truncate font-barlow text-[12px] text-white/55">
                            {chain.seasons.length} {chain.seasons.length === 1 ? 'season' : 'seasons'} · {seasonLabel(chain.seasons[0].season)} to {seasonLabel(chain.latestSeason)}
                            {chain.numTeams ? ` · ${chain.numTeams} teams` : ''} · {SCORING_LABEL[chain.scoringType] ?? chain.scoringType}
                          </span>
                        </span>
                        {chain.seasons.some((s) => !s.isFinished) && <Chip>In play</Chip>}
                        <HistoryButton disabled={!target} onClick={() => void startYahoo(chain)}>Import</HistoryButton>
                      </div>
                    ))}
                    <p className="mt-2 font-barlow text-[11px] text-white/55">Fantasy data provided by Yahoo Fantasy</p>
                  </div>
                )}
              </Panel>

              <p className="font-barlow text-[12px] text-white/55">
                Rather have a person do it? <Link to="/bring-your-league" className="text-pressbox-orange-soft">Send us the settings</Link> and we set it up.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
