/**
 * One season's long parts, fetched when the season is opened: the draft in
 * order, the trades (players and picks), the keepers, the weekly results.
 * A dynasty league's history is mostly here.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { importApi, type SeasonDetail as SeasonDetailData } from '@/api/imports';
import { seasonLabel } from './trophyLabels';
import { groupTrades } from './trades';
import { cn } from '@/lib/utils';

const dataOf = <T,>(res: unknown): T | null => ((res as { data?: T })?.data ?? null);

type Tab = 'draft' | 'trades' | 'keepers' | 'weeks';
const TABS: Array<{ key: Tab; label: string }> = [{ key: 'draft', label: 'Draft' }, { key: 'trades', label: 'Trades' }, { key: 'keepers', label: 'Keepers' }, { key: 'weeks', label: 'Weeks' }];

export interface SeasonDetailProps {
  leagueId: string;
  season: number;
  nameOf: (memberId: string | null | undefined) => string;
}

export function SeasonDetail({ leagueId, season, nameOf }: SeasonDetailProps) {
  const [tab, setTab] = useState<Tab>('draft');
  const detail = useQuery({
    queryKey: ['league-history-season', leagueId, season],
    staleTime: 5 * 60_000,
    queryFn: async () => dataOf<SeasonDetailData>(await importApi.getSeasonDetail(leagueId, season)),
  });
  const d = detail.data;
  const counts: Record<Tab, number> = { draft: d?.picks.length ?? 0, trades: groupTrades(d?.transactions ?? []).length, keepers: d?.keepers.length ?? 0, weeks: d?.matchups.length ? new Set(d.matchups.map((m) => m.week)).size : 0 };
  const shown = TABS.filter((t) => counts[t.key] > 0);
  if (detail.isLoading) return <p className="pb-2 pl-[80px] font-barlow text-[12px] text-white/55">Loading the season…</p>;
  if (!d || shown.length === 0) return null;
  const active = shown.some((t) => t.key === tab) ? tab : shown[0].key;
  const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated');

  return (
    <div className="pb-2 pl-[80px] pr-1" data-testid={`season-detail-${season}`}>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={`${seasonLabel(season)} details`}>
        {shown.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={active === t.key} onClick={() => setTab(t.key)}
            className={cn('rounded-[6px] px-2 h-7 font-plex font-semibold text-[10px] uppercase tracking-[0.08em]', active === t.key ? 'bg-pressbox-orange text-pressbox-orange-ink' : 'bg-white/[0.06] text-white/70')}>
            {t.label} · {counts[t.key]}
          </button>
        ))}
      </div>

      {active === 'draft' && (
        <ol className="mt-2 space-y-0.5" aria-label={`${seasonLabel(season)} draft`}>
          {d.picks.map((p) => (
            <li key={p.overall_pick} className="flex items-center gap-2 font-barlow text-[13px]">
              <span className="w-12 shrink-0 font-plex text-[11px] text-white/55">{p.round != null && p.pick_in_round != null ? `${p.round}.${String(p.pick_in_round).padStart(2, '0')}` : `#${p.overall_pick}`}</span>
              <span className="min-w-0 flex-1 truncate text-pressbox-text/90">{p.external_player_name ?? 'Unknown player'}{p.is_keeper ? <span className="ml-1.5 font-plex text-[10px] text-pressbox-orange-soft">KEEPER</span> : null}</span>
              <span className="truncate font-barlow text-[12px] text-white/55">{nameOf(p.member_id)}</span>
            </li>
          ))}
        </ol>
      )}

      {active === 'trades' && (
        <ul className="mt-2 space-y-1.5" aria-label={`${seasonLabel(season)} trades`}>
          {groupTrades(d.transactions).map((t) => (
            <li key={t.key} className="font-barlow text-[13px]">
              <span className="font-plex text-[11px] text-white/55">{dateOf(t.date)}</span>
              {t.sides.map((s) => (
                <span key={s.memberId ?? 'none'} className="block text-pressbox-text/90"><span className="text-white/55">{nameOf(s.memberId)} gets</span> {s.assets.join(', ')}</span>
              ))}
            </li>
          ))}
        </ul>
      )}

      {active === 'keepers' && (
        <ul className="mt-2 space-y-0.5" aria-label={`${seasonLabel(season)} keepers`}>
          {d.keepers.map((k) => (
            <li key={`${k.member_id}:${k.external_player_id}`} className="flex items-center gap-2 font-barlow text-[13px]">
              <span className="min-w-0 flex-1 truncate text-pressbox-text/90">{k.external_player_name ?? k.external_player_id}</span>
              <span className="truncate font-barlow text-[12px] text-white/55">{nameOf(k.member_id)}{k.round != null ? ` · round ${k.round}` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {active === 'weeks' && (
        <ul className="mt-2 space-y-0.5" aria-label={`${seasonLabel(season)} weekly results`}>
          {d.matchups.map((m) => (
            <li key={`${m.week}:${m.home_member_id}`} className="flex items-center gap-2 font-barlow text-[13px]">
              <span className="w-12 shrink-0 font-plex text-[11px] text-white/55">Wk {m.week}</span>
              <span className="min-w-0 flex-1 truncate text-pressbox-text/90">
                {nameOf(m.home_member_id)} <span className="text-white/55">vs</span> {m.away_member_id ? nameOf(m.away_member_id) : 'bye'}
              </span>
              <span className="font-plex text-[12px] text-white/70">
                {m.home_cat_wins != null ? `${m.home_cat_wins}-${m.home_cat_losses ?? 0}-${m.home_cat_ties ?? 0}` : m.home_score != null ? `${m.home_score} - ${m.away_score ?? ''}` : ''}
              </span>
              {m.is_championship && <span className="font-plex text-[10px] text-pressbox-orange-soft">FINAL</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
