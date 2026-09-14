/**
 * The commissioner's side of the trophy room: confirm the scoring and
 * keeper rules the import found, resolve players the crosswalk could not
 * place, tidy the managers (merge two rows that are one person, attach a
 * row to a manager, undo a wrong claim), and lock the history once it is
 * right. Every write is behind commissionerMiddleware on the server; this
 * only presents it.
 */
import { useMemo, useState } from 'react';
import type { LeagueHistory, ImportPlatform } from '@/api/imports';
import { importApi } from '@/api/imports';
import { leagueApi } from '@/api/leagues';
import { playerApi } from '@/api/players';
import { useToast } from '@/hooks/use-toast';
import { FORMAT_LABEL, planFromImportedSettings } from './importedSettings';
import { seasonLabel, statName } from './trophyLabels';
import { Chip, Eyebrow, HistoryButton, Panel, Row, inputClass } from './ui';

export interface CommissionerHistoryToolsProps {
  leagueId: string;
  history: LeagueHistory;
  /** Citrus managers in the league, for attaching an imported row to one of them. */
  managers: Array<{ userId: string; label: string }>;
  onChanged: () => void;
}

const KEEPER_COSTS = [
  { value: 'none', label: 'Free (last-round pick)' },
  { value: 'round-cost', label: 'Costs the round he was drafted in' },
  { value: 'round-escalation', label: 'One round earlier each year kept' },
];

export function CommissionerHistoryTools({ leagueId, history, managers, onChanged }: CommissionerHistoryToolsProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const settings = history.importedSettings;
  const plan = useMemo(() => (settings ? planFromImportedSettings(settings) : null), [settings]);
  const [keeperCost, setKeeperCost] = useState('round-cost');

  const run = async (key: string, work: () => Promise<void>, done: { title: string; description?: string }) => {
    setBusy(key);
    try {
      await work();
      toast(done);
      onChanged();
    } catch (e) {
      toast({ title: "That didn't save", description: (e as Error).message || 'Try again in a moment.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="commissioner-history-tools">
      {/* ---- confirm scoring and keepers ------------------------------------- */}
      {settings && plan && (
        <Panel testId="confirm-settings">
          <Eyebrow>✦ Confirm your rules · from {settings.platform === 'espn' ? 'ESPN' : 'Yahoo'}, {seasonLabel(settings.season)}</Eyebrow>
          <p className="mt-1 font-condensed font-bold text-[16px] text-pressbox-text">
            {settings.scoringFormat ? FORMAT_LABEL[settings.scoringFormat] ?? settings.scoringFormat : 'Format not recognised'}
            {settings.draftType ? ` · ${settings.draftType.toLowerCase()} draft` : ''}
            {settings.usesFaab ? ' · FAAB waivers' : ''}
          </p>

          {plan.scoring && (
            <div className="mt-3">
              <p className="font-plex text-[11px] uppercase tracking-[0.1em] text-white/55">Point values</p>
              <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-barlow text-[13px] text-pressbox-text/85 sm:grid-cols-3">
                {[...Object.entries(plan.scoring.skater), ...Object.entries(plan.scoring.goalie)].map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2"><span className="truncate">{statName(k)}</span><span className="font-plex">{v}</span></li>
                ))}
              </ul>
              <HistoryButton className="mt-2" busy={busy === 'scoring'} onClick={() => run('scoring', async () => {
                await leagueApi.updateScoringSettings(leagueId, plan.scoring!);
              }, { title: 'Scoring applied', description: 'Every category from your old league now scores the same here.' })}>
                Use this scoring
              </HistoryButton>
            </div>
          )}

          {plan.categories && (
            <div className="mt-3">
              <p className="font-plex text-[11px] uppercase tracking-[0.1em] text-white/55">Categories · {plan.categories.ids.length}</p>
              <p className="mt-1 font-barlow text-[13px] text-pressbox-text/85">{settings.categories.map(statName).join(', ')}</p>
              {plan.categories.unsupported.length > 0 && (
                <p className="mt-1 font-barlow text-[12px] text-white/50">Citrus does not score {plan.categories.unsupported.map(statName).join(', ')} yet; those are left out.</p>
              )}
              <HistoryButton className="mt-2" disabled={plan.categories.ids.length < 2} busy={busy === 'categories'} onClick={() => run('categories', async () => {
                await leagueApi.updateCategorySettings(leagueId, plan.categories!.ids);
              }, { title: 'Categories applied' })}>
                Use these categories
              </HistoryButton>
            </div>
          )}

          <div className="mt-3">
            <p className="font-plex text-[11px] uppercase tracking-[0.1em] text-white/55">Roster</p>
            <p className="mt-1 font-barlow text-[13px] text-pressbox-text/85">
              {Object.entries(plan.roster.slots).map(([slot, n]) => `${n} ${slot}`).join(' · ') || 'No roster slots were reported'}
              {plan.roster.unsupported.length > 0 ? ` · not in Citrus: ${plan.roster.unsupported.map((r) => `${r.count} ${r.slot}`).join(', ')}` : ''}
            </p>
            {Object.keys(plan.roster.slots).length > 0 && (
              <HistoryButton className="mt-2" busy={busy === 'roster'} onClick={() => run('roster', async () => {
                await leagueApi.updateRosterSlots(leagueId, plan.roster.slots);
              }, { title: 'Roster applied' })}>
                Use this roster
              </HistoryButton>
            )}
          </div>

          <div className="mt-3">
            <p className="font-plex text-[11px] uppercase tracking-[0.1em] text-white/55">Keepers</p>
            <p className="mt-1 font-barlow text-[13px] text-pressbox-text/85">
              {plan.keeper.count > 0 ? `${plan.keeper.count} per team on ${settings.platform === 'espn' ? 'ESPN' : 'Yahoo'}. Neither platform records what a keeper costs; pick the rule your league plays by.` : 'The newest season had no keepers. Turn them on in league settings if your league keeps players.'}
            </p>
            {plan.keeper.count > 0 && (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="keeper-cost">Keeper cost rule</label>
                <select id="keeper-cost" value={keeperCost} onChange={(e) => setKeeperCost(e.target.value)} className={`${inputClass} sm:max-w-xs`}>
                  {KEEPER_COSTS.map((o) => <option key={o.value} value={o.value} className="text-black">{o.label}</option>)}
                </select>
                <HistoryButton busy={busy === 'keepers'} onClick={() => run('keepers', async () => {
                  await leagueApi.updateKeeperSettings(leagueId, { keeperEnabled: true, keeperCount: plan.keeper.count, keeperPenalty: keeperCost, dynastyMode: false });
                }, { title: 'Keeper rules applied', description: `${plan.keeper.count} keepers per team.` })}>
                  Use these keeper rules
                </HistoryButton>
              </div>
            )}
          </div>

          {plan.notes.length > 0 && (
            <ul className="mt-3 space-y-0.5 font-barlow text-[12px] text-white/50">
              {plan.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </Panel>
      )}

      {/* ---- unmatched players ---------------------------------------------- */}
      {history.unmatchedPlayers.length > 0 && (
        <UnmatchedPlayers leagueId={leagueId} players={history.unmatchedPlayers} onChanged={onChanged} />
      )}

      {/* ---- managers ------------------------------------------------------- */}
      <MemberTools leagueId={leagueId} history={history} managers={managers} busy={busy} run={run} />

      {/* ---- lock and recompute --------------------------------------------- */}
      <Panel testId="history-lock">
        <Eyebrow>✦ When it all looks right</Eyebrow>
        <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-white/55">
          Locking keeps a re-import from touching seasons already here; new seasons still land. Recompute rebuilds the record book from the seasons after any change.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <HistoryButton tone="quiet" busy={busy === 'recompute'} onClick={() => run('recompute', async () => { await importApi.recompute(leagueId); }, { title: 'Record book rebuilt' })}>
            Recompute records
          </HistoryButton>
          {!history.league?.history_locked ? (
            <HistoryButton busy={busy === 'lock'} onClick={() => run('lock', async () => { await importApi.lock(leagueId); }, { title: 'History locked', description: 'Existing seasons are safe from re-imports. New seasons still come through.' })}>
              Lock history
            </HistoryButton>
          ) : (
            <Chip tone="sage">Locked</Chip>
          )}
        </div>
      </Panel>
    </div>
  );
}

function UnmatchedPlayers({ leagueId, players, onChanged }: { leagueId: string; players: LeagueHistory['unmatchedPlayers']; onChanged: () => void }) {
  const { toast } = useToast();
  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: number; full_name: string; team: string; position: string }>>([]);
  const [searching, setSearching] = useState(false);

  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await playerApi.searchPlayers({ search: q.trim(), limit: 8 });
      setResults(((res as { data?: unknown }).data as Array<{ id: number; full_name: string; team: string; position: string }>) ?? []);
    } finally {
      setSearching(false);
    }
  };

  const resolve = async (platform: string, externalPlayerId: string, nhlPlayerId: number, name: string) => {
    try {
      await importApi.resolvePlayer(leagueId, platform as ImportPlatform, externalPlayerId, nhlPlayerId);
      toast({ title: 'Player matched', description: `${name} is linked for every league that imports him.` });
      setActive(null);
      setQuery('');
      setResults([]);
      onChanged();
    } catch (e) {
      toast({ title: "That didn't save", description: (e as Error).message });
    }
  };

  return (
    <Panel testId="unmatched-players">
      <Eyebrow>✦ Players we could not place · {players.length}</Eyebrow>
      <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-white/55">
        Draft picks whose player is not in our directory yet, usually retired. Their names are kept; match one to link him to his Citrus page.
      </p>
      {players.map((p, i) => {
        const key = `${p.platform}:${p.externalPlayerId}`;
        const open = active === key;
        return (
          <div key={key} className={i < players.length - 1 ? 'border-b border-white/[0.06]' : ''}>
            <Row last>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-condensed font-bold text-[15px] text-pressbox-text">{p.name ?? `Player ${p.externalPlayerId}`}</span>
                <span className="block font-barlow text-[12px] text-white/50">{p.platform === 'espn' ? 'ESPN' : 'Yahoo'} id {p.externalPlayerId} · last seen {seasonLabel(p.season)}</span>
              </span>
              <HistoryButton tone="quiet" onClick={() => { setActive(open ? null : key); setQuery(p.name ?? ''); setResults([]); if (!open && p.name) void search(p.name); }}>
                {open ? 'Close' : 'Match'}
              </HistoryButton>
            </Row>
            {open && (
              <div className="pb-3">
                <label className="sr-only" htmlFor={`search-${key}`}>Search players</label>
                <input id={`search-${key}`} value={query} onChange={(e) => void search(e.target.value)} placeholder="Type a player's name" className={inputClass} autoComplete="off" />
                {searching && <p className="mt-1 font-barlow text-[12px] text-white/55">Searching…</p>}
                <ul className="mt-1">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => void resolve(p.platform, p.externalPlayerId, r.id, r.full_name)} className="flex w-full items-center justify-between py-2 text-left font-barlow text-[13px] text-pressbox-text/90 hover:text-pressbox-orange-soft">
                        <span>{r.full_name}</span>
                        <span className="font-plex text-[11px] text-white/55">{r.team} · {r.position}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function MemberTools({ leagueId, history, managers, busy, run }: {
  leagueId: string; history: LeagueHistory; managers: Array<{ userId: string; label: string }>; busy: string | null;
  run: (key: string, work: () => Promise<void>, done: { title: string; description?: string }) => Promise<void>;
}) {
  const [from, setFrom] = useState('');
  const [into, setInto] = useState('');
  const [assignMember, setAssignMember] = useState('');
  const [assignUser, setAssignUser] = useState('');
  const members = [...history.members].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const unclaimed = members.filter((m) => !m.owner_id);
  const claimed = members.filter((m) => m.owner_id);

  return (
    <Panel testId="member-tools">
      <Eyebrow>✦ Managers</Eyebrow>
      <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-white/55">
        One person, one row. Merge two names that are the same manager (a co-manager, someone who changed accounts); attach a row to a Citrus manager; undo a claim that went to the wrong person.
      </p>

      <div className="mt-3">
        <p className="font-plex text-[11px] uppercase tracking-[0.1em] text-white/55">Merge</p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="merge-from">Merge this row</label>
          <select id="merge-from" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass}>
            <option value="" className="text-black">This row…</option>
            {members.map((m) => <option key={m.member_id} value={m.member_id} className="text-black">{m.display_name}</option>)}
          </select>
          <label className="sr-only" htmlFor="merge-into">into this row</label>
          <select id="merge-into" value={into} onChange={(e) => setInto(e.target.value)} className={inputClass}>
            <option value="" className="text-black">…is the same person as</option>
            {members.filter((m) => m.member_id !== from).map((m) => <option key={m.member_id} value={m.member_id} className="text-black">{m.display_name}</option>)}
          </select>
          <HistoryButton disabled={!from || !into} busy={busy === 'merge'} onClick={() => run('merge', async () => {
            await importApi.mergeMembers(leagueId, from, into);
            setFrom(''); setInto('');
          }, { title: 'Managers merged', description: 'Every season, trophy and record moved to the surviving row.' })}>
            Merge
          </HistoryButton>
        </div>
      </div>

      {unclaimed.length > 0 && managers.length > 0 && (
        <div className="mt-3">
          <p className="font-plex text-[11px] uppercase tracking-[0.1em] text-white/55">Attach a row to a manager</p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="assign-member">Unclaimed row</label>
            <select id="assign-member" value={assignMember} onChange={(e) => setAssignMember(e.target.value)} className={inputClass}>
              <option value="" className="text-black">Unclaimed row…</option>
              {unclaimed.map((m) => <option key={m.member_id} value={m.member_id} className="text-black">{m.display_name}</option>)}
            </select>
            <label className="sr-only" htmlFor="assign-user">Citrus manager</label>
            <select id="assign-user" value={assignUser} onChange={(e) => setAssignUser(e.target.value)} className={inputClass}>
              <option value="" className="text-black">…belongs to</option>
              {managers.map((u) => <option key={u.userId} value={u.userId} className="text-black">{u.label}</option>)}
            </select>
            <HistoryButton disabled={!assignMember || !assignUser} busy={busy === 'assign'} onClick={() => run('assign', async () => {
              await importApi.assignMember(leagueId, assignMember, assignUser);
              setAssignMember(''); setAssignUser('');
            }, { title: 'Row attached' })}>
              Attach
            </HistoryButton>
          </div>
        </div>
      )}

      {claimed.length > 0 && (
        <div className="mt-3">
          <p className="font-plex text-[11px] uppercase tracking-[0.1em] text-white/55">Claimed</p>
          {claimed.map((m, i) => (
            <Row key={m.member_id} last={i === claimed.length - 1}>
              <span className="min-w-0 flex-1 truncate font-condensed font-bold text-[15px] text-pressbox-text">{m.display_name}</span>
              <HistoryButton tone="quiet" busy={busy === `unclaim:${m.member_id}`} onClick={() => run(`unclaim:${m.member_id}`, async () => {
                await importApi.unclaimMember(leagueId, m.member_id);
              }, { title: 'Claim removed', description: `${m.display_name} is open to be claimed again.` })}>
                Unclaim
              </HistoryButton>
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
}
