import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useIsMobile } from '@/hooks/useIsMobile';
import './connectedDesk.css';
import type { ScoringSettings } from '@citrus/shared';
import { PlayerCompare } from './PlayerCompare';
import { deskComparePlayers, weightedCompareStats } from './compareAdapters';
import { deskScoringDifferences, liveDeskProgress, MAX_DESK_FILE_BYTES, readDeskFile,
  validateDeskProgress, type DeskFile, type DeskPlayer, type DeskProgress, type DeskRow } from './deskConnection';

export interface DeskLiveState {
  sourceLabel?: 'Yahoo' | 'ESPN';
  transport?: 'browser';
  status: 'live' | 'catching-up' | 'disconnected' | 'finished' | 'waiting' | 'denied';
  unavailableIds: ReadonlySet<string>;
  sequence: number | null;
}
const statusText: Record<DeskLiveState['status'], string> = {
  live: 'Following Citrus picks', 'catching-up': 'Catching up. Availability may be stale.',
  disconnected: 'Connection interrupted. Availability may be stale.', finished: 'Draft ended',
  waiting: 'Waiting for confirmed draft state', denied: 'Connection unavailable. Re-enter the draft room to verify access.',
};
const control = 'rounded-lg border border-[#cbd5c7] bg-[#f8f5ec] px-3 py-2 text-sm text-[#10291f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ff6b1a]';
const number = (v: number | null | undefined) => v == null ? 'N/A' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 });
const skaterStats = [['goals', 'G', 'Goals'], ['assists', 'A', 'Assists'], ['shots_on_goal', 'SOG', 'Shots on goal'], ['power_play_points', 'PPP', 'Power-play points'], ['short_handed_points', 'SHP', 'Short-handed points'], ['hits', 'HIT', 'Hits'], ['blocks', 'BLK', 'Blocks'], ['penalty_minutes', 'PIM', 'Penalty minutes']];
const goalieStats = [['wins', 'W', 'Wins'], ['saves', 'SV', 'Saves'], ['goals_against', 'GA', 'Goals against'], ['shutouts', 'SO', 'Shutouts']];
const playerStats = (p: DeskPlayer) => p.goalie ? goalieStats :
  p.totals.plus_minus !== undefined ? [...skaterStats, ['plus_minus', '+/−', 'Plus/minus']] : skaterStats;

export function DraftDeskPanel({ live, scoring, scoringReady, initialFile, cloud, onReturnToDraft }: {
  live: DeskLiveState; scoring: ScoringSettings; scoringReady: boolean;
  initialFile?: DeskFile; cloud?: { onEdit: (key: string, patch: { note?: string; target?: boolean }) => void; status: string; scope?: 'browser' }; onReturnToDraft?: () => void;
}) {
  const connectionText = live.sourceLabel && live.status === 'live' ? live.transport === 'browser' ? `Following ${live.sourceLabel} picks · read-only` : `${live.sourceLabel} source snapshots (15-second checks)` : statusText[live.status];
  const pickInstruction = live.sourceLabel ? `Make your picks in your ${live.sourceLabel} draft room.` : 'Make your picks in the Players tab.';
  const [file, setFile] = useState<DeskFile | null>(initialFile ?? null), [pendingFile, setPendingFile] = useState<DeskFile | null>(null);
  const [error, setError] = useState(''), [search, setSearch] = useState(''), [position, setPosition] = useState('');
  const [hideTaken, setHideTaken] = useState(true), [onlyTargets, setOnlyTargets] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const mobile = useIsMobile();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const sheetHeading = useRef<HTMLHeadingElement | null>(null);
  const settingsId = useId();
  const returningToDraft = useRef(false);
  function returnToDraft() {
    returningToDraft.current = mobile && detailsOpen;
    setDetailsOpen(false);
    onReturnToDraft?.();
  }
  const needsSave = cloud ? cloud.status !== 'Saved' : unsaved;
  const remaining = (!!cloud && cloud.scope !== 'browser') || file?.kit.projectionBasis === 'remaining_season';
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    if (!needsSave) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [needsSave]);
  useEffect(() => {
    if (live.status === 'live' || live.status === 'finished') setLastUpdate(new Date().toLocaleTimeString());
  }, [live.sequence, live.status]);
  const progress = useMemo(() => file ? liveDeskProgress(file.kit, file.progress.rows, live.unavailableIds) : null,
    [file, live.unavailableIds]);
  const rows = useMemo(() => new Map(progress?.rows.map(r => [r.key, r]) ?? []), [progress]);
  const differences = file && scoringReady ? deskScoringDifferences(file.kit, scoring) : [];
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const visible = (file?.kit.players ?? []).filter(p => (!hideTaken || !rows.get(p.key)?.drafted)
    && (!onlyTargets || rows.get(p.key)?.target) && (!position || p.position === position)
    && normalize(`${p.name} ${p.team}`).includes(normalize(search.trim())));
  const player = file?.kit.players.find(p => p.key === selected);
  const taken = progress?.rows.filter(r => r.drafted).length ?? 0;
  const remainingTargets = progress?.rows.filter(r => r.target && !r.drafted).length ?? 0;
  function activate(next: DeskFile) {
    setFile(next); setPendingFile(null); setSelected(null); setDetailsOpen(false); setSearch(''); setPosition(''); setOnlyTargets(false); setHideTaken(true); setUnsaved(false);
  }
  async function load(upload: File | undefined, progressOnly = false) {
    if (!upload) return;
    const generation = ++request.current;
    setError('');
    try {
      if (upload.size > MAX_DESK_FILE_BYTES) throw Error('Draft desk files must be smaller than 1 MB.');
      const content = await upload.text();
      if (generation !== request.current) return;
      if (progressOnly) {
        if (!file) throw Error('Load your draft desk first.');
        const imported = validateDeskProgress(JSON.parse(content), file.kit);
        setPendingFile({ ...file, progress: imported });
      } else {
        const next = readDeskFile(content);
        if (file) setPendingFile(next); else activate(next);
      }
    } catch (e) {
      if (generation === request.current) setError(e instanceof Error ? e.message : 'Could not load your desk.');
    }
  }
  function edit(key: string, patch: { target?: boolean; note?: string }) {
    cloud?.onEdit(key, patch);
    setUnsaved(true);
    setFile(previous => {
      if (!previous) return previous;
      const next = new Map<string, DeskRow>(previous.progress.rows.map(r => [r.key, r]));
      next.set(key, { key, drafted: false, target: false, note: '', ...next.get(key), ...patch });
      return { ...previous, progress: { ...previous.progress, rows: [...next.values()] } };
    });
  }
  function download(progressOnly: boolean) {
    if (!file || !progress) return;
    const payload: DeskProgress | DeskFile = progressOnly ? progress : { ...file, progress };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url;
    a.download = progressOnly ? 'Citrus-Draft-Progress.json' : 'Citrus-Connected-Desk.json';
    a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    setUnsaved(false);
  }
  const unavailable = live.status === 'waiting' || live.status === 'denied';
  const playerDetails = player && <>
    <p className="mt-1 text-sm text-[#526759]">{player.team} / {player.position} · Kit rank #{player.rank}</p>
    <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[#e5eadf] p-3">
      <div><p className="text-xs text-[#526759]">Projected fantasy points</p><p className="font-barlow text-3xl font-bold">{number(player.points)}</p></div>
      <p role="status" className="text-sm font-bold">{unavailable ? 'Availability unverified' : rows.get(player.key)?.drafted ? 'Drafted or kept' : live.status === 'live' || live.status === 'finished' ? 'Available' : 'Last seen available'}</p>
    </div>
    <PlayerTotals player={player} remaining={remaining} />
    <section aria-label={`Citrus research for ${player.name}`} className="mt-4 space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-wider">The Citrus read</h4>
      {player.research?.length?player.research.map((item,index)=><article key={index} className="rounded-lg border border-[#cbd5c7] p-3">
        <p className="text-xs text-[#526759]">{item.kind==='history'?'From the archive':'Season context'} · {item.date}</p>
        <h5 className="mt-1 font-bold">{item.headline}</h5><p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{item.body}</p>
        <ul className="mt-2 space-y-1 text-xs">{item.sources.map(source=><li key={source.url}><a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></li>)}</ul>
      </article>):<p className="text-xs text-[#526759]">No reviewed Citrus reading is attached to this edition for this player.</p>}
    </section>
    {mobile && <button className={`${control} mt-4 w-full min-h-11 font-bold`} aria-pressed={rows.get(player.key)?.target ?? false} onClick={() => edit(player.key, { target: !rows.get(player.key)?.target })}>{rows.get(player.key)?.target ? '★ On your shortlist' : '☆ Add to shortlist'}</button>}
    <label className="mt-4 block text-xs font-bold">Your note for {player.name}<textarea className={`${control} mt-2 min-h-20 w-full`} maxLength={500} value={rows.get(player.key)?.note ?? ''} onChange={e => edit(player.key, { note: e.target.value })} /></label>
    <p className="mt-1 text-xs text-[#526759]">500 characters maximum. {cloud ? 'Changes save automatically.' : 'Save your session to keep it.'}</p>
    {mobile && <p className="mt-4 text-xs text-[#526759]">Shortlisting does not queue a pick. {pickInstruction}</p>}
  </>;
  const fileInput = <label className="block text-sm font-bold">{file ? 'Load another desk or saved session' : 'Load your Citrus draft desk'}
    <input type="file" accept=".html,.json,text/html,application/json" className={`${control} mt-2 block w-full`} onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} />
  </label>;
  return <section aria-label="Connected Citrus draft desk" className="citrus-connected-desk overflow-hidden rounded-xl border border-[#334a3b] bg-[#f8f5ec] text-[#10291f]">
    <header className="citrus-desk-header bg-[#10291f] text-[#f8f5ec]">
      {onReturnToDraft && <button className="mb-2 min-h-11 rounded-lg border border-white/30 px-3 text-sm font-bold" onClick={returnToDraft}>← Back to draft</button>}
      <div className="flex items-center justify-between gap-3"><div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ff9a61]">Your draft companion</p>
        <h2 className="mt-1 font-barlow text-3xl font-black uppercase lg:text-4xl">Citrus Draft Desk</h2>
      </div>{file && <button aria-expanded={optionsOpen} aria-controls={settingsId} className="min-h-11 rounded-lg border border-white/30 px-3 text-xs font-bold" onClick={() => setOptionsOpen(!optionsOpen)}>Desk options</button>}</div>
      {!mobile && <p className="mt-2 max-w-xl text-sm text-[#d5ded2]">Keep a shortlist and your own notes alongside your custom board. {pickInstruction}</p>}
      <p role="status" className="mt-3 text-xs font-bold text-[#d5ded2]">{connectionText}{!mobile && lastUpdate && !unavailable ? <span className="ml-2 font-normal">Last draft update {lastUpdate}</span> : null}</p>
    </header>
    <div className="citrus-desk-body space-y-3">
      {!cloud && !file && fileInput}
      {!file && <div className="rounded-lg border border-[#d4dacf] p-4 text-sm leading-relaxed">
        <p>Choose the <strong>Offline draft desk</strong> HTML from your kit downloads. We read its player list only; the file never runs inside Citrus.</p>
        <p className="mt-2">Already made notes? Use “Export for Citrus draft” in your offline desk, then load that JSON here. You can also restore its progress file after loading the HTML.</p>
      </div>}
      {error && <p role="alert" className="rounded-lg bg-red-100 p-3 text-sm text-red-900">{error}</p>}
      {pendingFile && <div role="alert" className="rounded-lg border border-[#ff6b1a] p-4 text-sm">
        <p>Replace your current desk, targets and notes? Save your session first if you want to keep them.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button className={control} onClick={() => activate(pendingFile)}>Replace current desk</button><button className={control} onClick={() => setPendingFile(null)}>Cancel replacement</button></div>
      </div>}
      {file && <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#10291f]">{file.kit.league}</h3>
          {cloud && <p role="status" className="text-xs text-[#526759]">{cloud.status === 'Saved' ? cloud.scope === 'browser' ? 'Saved for this browser session. Download a backup before closing.' : mobile ? 'Saved to your account' : 'Notes and targets saved to your account.' : cloud.status}</p>}
        </div>
        {(!scoringReady || differences.length > 0) && <p role="alert" className="rounded-lg border border-[#d78a3a] bg-[#fff1d8] p-3 text-sm">
          {!scoringReady ? 'League scoring has not been verified.' : `This kit differs from the room’s scoring: ${differences.join(', ')}.`} {cloud && cloud.scope !== 'browser' ? 'Save any pending notes, then reload the room to update your board.' : 'Rankings and FPTS below use this kit’s scoring, not verified provider settings.'}</p>}
        <PlayerCompare compact={cloud?.scope==='browser'} key={file.kit.fingerprint} players={deskComparePlayers(file.kit,live.unavailableIds,live.status)} stats={weightedCompareStats(file.kit.weights)} context={`${remaining?'Remaining-season':'Season'} projections · ${file.kit.projectionDate} · ${file.kit.league}. Uses this desk’s scoring and edition.`} availability={connectionText} />
        <details id={settingsId} open={optionsOpen} onToggle={e => setOptionsOpen(e.currentTarget.open)} className="citrus-desk-options rounded-lg border border-[#d4dacf] p-3 text-xs"><summary className="cursor-pointer font-bold">Scoring, edition & backups</summary><div className="mt-3 space-y-3">
        <p>{cloud ? 'Published Citrus projections' : 'Imported kit'} / Projections {file.kit.projectionDate}</p>
        {scoringReady && differences.length === 0 && <p className="text-xs text-[#526759]">{cloud ? 'Scored for your league from published Citrus projections. Picks update live; ranks stay fixed while this desk is open.' : 'Points weights match this room. Ranks and forecasts stay fixed to your imported edition; this is not a live projection or eligibility refresh.'}</p>}
        {!cloud && fileInput}
        <details open={cloud ? undefined : true} className="text-xs"><summary className="cursor-pointer font-bold">{cloud ? 'Download a backup' : 'Session files'}</summary>
        <div className="flex flex-wrap gap-2">
          <button className={control} onClick={() => download(false)}>Save session file</button>
          {!remaining && <button className={control} onClick={() => download(true)}>Save offline progress</button>}
          {!cloud && <label className={`${control} cursor-pointer`}>Restore notes and targets<input aria-label="Restore notes and targets" type="file" accept=".json,application/json" className="sr-only" onChange={e => { void load(e.target.files?.[0], true); e.target.value = ''; }} /></label>}
        </div>
        </details>
        {!cloud && <p className="text-xs text-[#526759]">{unsaved ? 'Unsaved notes or targets. ' : ''}Notes stay in this tab, not the cloud. Save your session before reloading or leaving.</p>}
        <details className="text-xs"><summary className="cursor-pointer font-bold">Scoring and backups</summary><p className="mt-2">{remaining ? 'Your session file backs up this published board, notes and targets. It may differ from an older downloaded kit and cannot restore progress into that edition’s HTML. Saved picks reflect the last received draft state.' : 'To work offline, restore the progress file in your original HTML desk. During a connection interruption, saved picks reflect the last received state. Loading a session restores notes and targets; Citrus replaces its manual pick marks.'}</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(file.kit.weights).map(([group, values]) => <p key={group}><strong>{group === 'skater' ? 'Skaters' : 'Goalies'}</strong><br />{Object.entries(values).map(([key, v]) => `${key.replace(/_/g, ' ')}: ${v}`).join(' · ')}</p>)}</div></details>
        </div></details>
        {!cloud && unsaved && <p role="status" className="text-xs font-bold text-[#9b3c00]">Unsaved changes. Open Desk options to save a backup.</p>}
        {unavailable ? <p className="p-4 text-sm">Availability is hidden until the draft connection can be verified. Your notes are retained.</p> : <>
          <div className="citrus-desk-filters flex flex-wrap items-end gap-3">
            <label className="min-w-0 grow text-xs font-bold">Find a player<input ref={searchInput} className={`${control} mt-1 block w-full`} type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Player name" /></label>
            <label className="text-xs font-bold">Position<select className={`${control} mt-1 block`} value={position} onChange={e => setPosition(e.target.value)}><option value="">All</option>{[...new Set(file.kit.players.map(p => p.position))].sort().map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="py-2 text-sm"><input type="checkbox" checked={hideTaken} onChange={e => setHideTaken(e.target.checked)} /> Hide drafted / kept</label>
            <label className="py-2 text-sm"><input type="checkbox" checked={onlyTargets} onChange={e => setOnlyTargets(e.target.checked)} /> Targets only</label>
          </div>
          <p className="citrus-desk-count text-xs text-[#526759]"><strong>{visible.length}</strong> shown · {file.kit.players.length - taken} {live.status==='live'||live.status==='finished'?'available':'last seen available'} · {remainingTargets} targets left{mobile && <span className="block">{remaining ? 'Remaining-season projections' : 'Season projections'} · {cloud&&scoringReady&&differences.length===0?'Scored for your league':'Scored for your kit'}</span>}</p>
          <div className="citrus-desk-grid items-start gap-4">
            <div className="citrus-desk-board max-h-[560px] overflow-auto rounded-lg border border-[#d4dacf]">
              <table className="w-full text-left text-sm"><caption className="sr-only">Kit rankings with confirmed Citrus availability</caption>
                <thead className="sticky top-0 bg-[#10291f] text-xs text-[#f8f5ec]"><tr>{['Rank', 'Player', 'FPTS', 'Target'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead>
                {visible.map((p, index) => <tbody key={p.key} className={`border-t border-[#d4dacf] ${p.key === selected ? 'bg-[#ffe2ca]' : index % 2 ? 'bg-[#edf0e7]' : ''}`}><tr>
                  <td className="p-3">{p.rank}</td><td className="p-3"><button aria-label={p.name} aria-haspopup={mobile ? 'dialog' : undefined} className={`flex min-h-11 flex-col justify-center text-left font-bold underline-offset-4 hover:underline ${rows.get(p.key)?.drafted ? 'line-through' : ''}`} onClick={e => { selectedTrigger.current = e.currentTarget; setSelected(p.key); setDetailsOpen(true); }}><span className="font-bold">{p.name}</span><span className="text-xs font-normal text-[#526759]">{p.team} / {p.position}{rows.get(p.key)?.drafted ? ' / Drafted or kept' : ''}{rows.get(p.key)?.note ? ' · Note' : ''}</span></button></td>
                  <td className="p-3 tabular-nums">{number(p.points)}</td><td className="p-3"><button className="min-h-11 min-w-11 rounded-md text-2xl text-[#9b3c00]" aria-label={`Target: ${p.name}`} aria-pressed={rows.get(p.key)?.target ?? false} onClick={() => edit(p.key, { target: !rows.get(p.key)?.target })}>{rows.get(p.key)?.target ? '★' : '☆'}</button></td>
                </tr>{mobile && <tr className="citrus-desk-stat-row"><td colSpan={4}><RowProjections player={p} remaining={remaining} /></td></tr>}</tbody>)}
              </table>{!visible.length && <p className="p-6 text-sm">No players match. Clear your search or filters.</p>}
            </div>
            {!mobile && <aside className="citrus-desk-detail rounded-lg bg-[#e5eadf] p-4" aria-label="Draft desk player details">
              {player ? <><h3 className="font-barlow text-2xl font-bold uppercase text-[#10291f]">{player.name}</h3>{playerDetails}</> : <><h3 className="font-barlow text-2xl font-bold uppercase text-[#10291f]">Keep your next options ready.</h3><p className="mt-2 text-sm">Star your targets. Select a name for projections and your notes.</p><p className="mt-3 text-xs">Targets here do not change your draft queue or trigger autopicks.</p></>}
            </aside>}
          </div>
        </>}
      </>}
    </div>
    {mobile && <Dialog.Root open={detailsOpen && !!player} onOpenChange={setDetailsOpen}><Dialog.Portal>
      <Dialog.Overlay className="citrus-desk-sheet-overlay z-sheet" />
      <Dialog.Content className="citrus-desk-sheet z-sheet" onOpenAutoFocus={e => { e.preventDefault(); sheetHeading.current?.focus(); }} onCloseAutoFocus={e => { e.preventDefault(); if (returningToDraft.current) { returningToDraft.current = false; return; } const target = selectedTrigger.current; (target?.isConnected ? target : searchInput.current)?.focus({ preventScroll: true }); }}>
        <div className="citrus-desk-sheet-heading"><div><Dialog.Description className="text-xs font-bold uppercase tracking-widest text-[#526759]">Your player notebook</Dialog.Description><Dialog.Title ref={sheetHeading} tabIndex={-1} className="mt-1 font-barlow text-3xl font-bold uppercase text-[#10291f] outline-none">{player?.name}</Dialog.Title></div><Dialog.Close className={`${control} min-h-11 shrink-0 font-bold`}>Done</Dialog.Close></div>
        <div className="citrus-desk-sheet-body"><p role="status" className="text-xs font-bold text-[#526759]">{connectionText}</p>{playerDetails}{cloud && <p role="status" className="mt-3 text-xs font-bold">{cloud.status}</p>}</div>
        {onReturnToDraft && <div className="citrus-desk-sheet-footer"><button className="min-h-11 w-full rounded-lg bg-[#10291f] px-4 py-3 text-sm font-bold text-[#f8f5ec]" onClick={returnToDraft}>Back to draft · Players</button></div>}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
  </section>;
}

function RowProjections({ player: p, remaining = false }: { player: DeskPlayer; remaining?: boolean }) {
  const stats = playerStats(p);
  return <dl aria-label={`Projected ${remaining ? 'remaining' : 'season'} totals for ${p.name}`} data-stat-count={stats.length} className="citrus-desk-row-projections">
    {stats.map(([key, label, full]) => <div key={key}><dt title={full}>{label}</dt><dd>{number(p.totals[key])}</dd></div>)}
  </dl>;
}

function PlayerTotals({ player: p, remaining = false }: { player: DeskPlayer; remaining?: boolean }) {
  const stats = playerStats(p);
  return <><p className="mt-4 text-xs font-bold uppercase">{remaining ? 'Projected remaining totals' : 'Projected season totals'}</p><dl className="citrus-desk-detail-projections mt-2 gap-x-3 gap-y-2">{[[p.goalie ? 'Starts' : 'GP', p.games], ...stats.map(([key, label]) => [label, p.totals[key]])].map(([label, v]) => <div key={String(label)}><dt className="text-xs text-[#526759]">{label}</dt><dd className="font-barlow text-xl font-bold">{number(v as number | null | undefined)}</dd></div>)}</dl></>;
}
