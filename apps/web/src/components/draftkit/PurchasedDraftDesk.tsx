import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { isNativeShell } from '@/lib/nativeAuth';
import type { ScoringSettings } from '@citrus/shared';
import { DraftDeskPanel, type DeskLiveState } from './ConnectedDraftDesk';
import { readDeskFile, type DeskFile } from './deskConnection';

type PreparedDesk = { owned: true; file: DeskFile; versions: Record<string, number>; warning?: string | null };
type Reply = PreparedDesk | { owned: false };
type Change = { note: string; target: boolean };
type Props = { leagueId: string; live: DeskLiveState; scoring: ScoringSettings; scoringReady: boolean; onReady?: (leagueId: string | null) => void; onReturnToDraft?: () => void };
const button = 'rounded-lg border border-[#66816e] px-4 py-2 text-sm font-bold';

/** Mounted with an account + league key. No paid kit is persisted in browser storage. */
export function PurchasedDraftDesk(props: Props) {
  if (import.meta.env.VITE_NATIVE === '1' || isNativeShell()) return null;
  return <BrowserPurchasedDraftDesk {...props} />;
}
function BrowserPurchasedDraftDesk(props: Props) {
  const { leagueId, onReady } = props;
  const [result, setResult] = useState<Reply | null>(null), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setResult(null);
    void apiClient.get<Reply>(`/api/draft-kit/desk/league/${encodeURIComponent(leagueId)}`,
      { signal: controller.signal, retries: 0, timeoutMs: 30000 }).then(({ data }) => {
      if (controller.signal.aborted) return;
      if (!data) throw Error('Could not load your kit.');
      if (data.owned) {
        const file = readDeskFile(JSON.stringify(data.file));
        setResult({ ...data, file }); onReady?.(leagueId);
      } else setResult(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not open your kit.'); });
    return () => { controller.abort(); onReady?.(null); };
  }, [leagueId, attempt, onReady]);
  if (error) return <section className="rounded-xl border border-orange-300 bg-[#f8f5ec] p-6 text-[#10291f]">
    <h2 className="text-xl font-bold">Your Citrus Draft Desk</h2><p role="alert" className="my-3">{error}</p>
    <button className={button} onClick={() => setAttempt(n => n + 1)}>Try again</button>
    {props.onReturnToDraft && <button className={`${button} ml-2`} onClick={props.onReturnToDraft}>Back to draft</button>}
  </section>;
  if (!result) return <p role="status" className="p-6">Getting your Citrus Draft Desk ready…</p>;
  if (!result.owned) return <section className="rounded-xl bg-[#f8f5ec] p-6 text-[#10291f]">
    <h2 className="text-2xl font-bold">Bring your draft kit into the room.</h2>
    <p className="my-3">Purchased the Citrus kit? Your board loads here automatically, with this league’s scoring and confirmed picks.</p>
    <a className={`${button} inline-block`} href="/draft-kit?tab=pricing">View the draft kit</a>
    <button className={`${button} ml-2`} onClick={() => setAttempt(n => n + 1)}>Refresh purchase access</button>
    {props.onReturnToDraft && <button className={`${button} ml-2`} onClick={props.onReturnToDraft}>Back to draft</button>}
    <details className="mt-5"><summary className="cursor-pointer text-sm">Use an offline file instead</summary>
      <div className="mt-3"><DraftDeskPanel live={props.live} scoring={props.scoring} scoringReady={props.scoringReady} onReturnToDraft={props.onReturnToDraft} /></div>
    </details>
  </section>;
  return <>
    {result.warning && <p role="status" className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-[#10291f]">{result.warning}</p>}
    <SavedDesk key={result.file.kit.fingerprint} {...props} prepared={result} />
  </>;
}

function SavedDesk({ prepared, leagueId, ...props }: Props & { prepared: PreparedDesk }) {
  const [status, setStatus] = useState('Saved'), [error, setError] = useState('');
  const rows = useRef(new Map(prepared.file.progress.rows.map(r => [r.key, { note: r.note, target: r.target }])));
  const versions = useRef({ ...prepared.versions });
  const pending = useRef(new Map<string, Change>());
  const running = useRef(false), mounted = useRef(false), timer = useRef<ReturnType<typeof setTimeout>>();
  const abort = useRef<AbortController>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); abort.current?.abort(); }; }, []);
  const flush = useCallback(async () => {
    if (running.current || !mounted.current) return;
    running.current = true; setError('');
    try {
      while (pending.current.size && mounted.current) {
        const [key, change] = pending.current.entries().next().value!;
        abort.current = new AbortController();
        const { data } = await apiClient.put<{ version: number }>(
          `/api/draft-kit/desk/league/${encodeURIComponent(leagueId)}/players/${encodeURIComponent(key)}`,
          { ...change, version: versions.current[key] ?? null }, { retries: 0, signal: abort.current.signal });
        if (!mounted.current) return;
        if (!data || !Number.isInteger(data.version)) throw Error('Your changes have not been saved.');
        versions.current[key] = data.version;
        // Preserve keystrokes made while this request was in flight.
        if (pending.current.get(key) === change) pending.current.delete(key);
      }
      if (mounted.current) setStatus('Saved');
    } catch (e) {
      if (mounted.current) { setStatus('Not saved'); setError(e instanceof Error ? e.message : 'Your changes have not been saved.'); }
    } finally { running.current = false; }
  }, [leagueId]);
  function edit(key: string, patch: Partial<Change>) {
    const next = { note: '', target: false, ...rows.current.get(key), ...patch };
    rows.current.set(key, next); pending.current.set(key, next); setStatus('Saving…');
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush(); }, 500);
  }
  return <>
    {error && <div role="alert" className="mb-3 rounded-lg bg-orange-100 p-4 text-[#10291f]">
      <p>{error} Your edits are still in this tab. Download a backup before leaving.</p>
      <button className={`${button} mt-2`} onClick={() => { setStatus('Saving…'); void flush(); }}>Retry save</button>
    </div>}
    <DraftDeskPanel {...props} initialFile={prepared.file} cloud={{ onEdit: edit, status }} />
  </>;
}
