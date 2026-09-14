/**
 * The trophy room: every season with its champion, the record book, and
 * the managers with their careers. Reads what the history endpoint says;
 * invents nothing. A computed record says so, so nobody mistakes Citrus's
 * arithmetic for a fact the source stated.
 */
import { useState } from 'react';
import type { LeagueHistory, Trophy } from '@/api/imports';
import { careerLine, groupAwards, groupTrophies, memberNamer, ordinal, seasonLabel, trophyLabel, trophyValueLine } from './trophyLabels';
import { Chip, Eyebrow, Panel, Row } from './ui';
import { SeasonDetail } from './SeasonDetail';

export interface TrophyRoomProps {
  history: LeagueHistory;
  currentUserId: string | null;
}

export function TrophyRoom({ history, currentUserId }: TrophyRoomProps) {
  const nameOf = memberNamer(history);
  const grouped = groupTrophies(history.trophies);
  const mine = currentUserId ? history.members.find((m) => m.owner_id === currentUserId)?.member_id ?? null : null;
  const seasons = [...history.seasons].sort((a, b) => b.season - a.season);
  const [openSeason, setOpenSeason] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {/* ---- seasons ------------------------------------------------------- */}
      <Panel testId="history-seasons">
        <Eyebrow>✦ Seasons · {seasons.length}</Eyebrow>
        {seasons.map((s, i) => {
          const rows = history.standings.filter((r) => r.season === s.season).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
          const open = openSeason === s.season;
          const champTrophy = grouped.season.find((t) => t.season === s.season && t.trophy_key === 'champion');
          const champId = champTrophy?.member_id ?? null;
          return (
            <div key={s.season} className={i < seasons.length - 1 ? 'border-b border-white/[0.06]' : ''}>
              <button
                type="button"
                onClick={() => setOpenSeason(open ? null : s.season)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 py-2.5 text-left"
              >
                <span className="w-[68px] shrink-0 font-plex font-semibold text-[13px] text-pressbox-text/80">{seasonLabel(s.season)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-condensed font-bold text-[16px] text-pressbox-text">
                    {s.champion ?? (champId ? nameOf(champId) : 'Season in play')}
                    {mine && champId === mine && <span className="ml-2 font-plex text-[10px] text-pressbox-orange-soft">YOU</span>}
                  </span>
                  <span className="block truncate font-barlow text-[12px] text-white/55">
                    {s.runner_up ? `Runner-up ${s.runner_up}` : 'No final recorded'}
                    {s.team_count ? ` · ${s.team_count} teams` : ''}
                    {champTrophy?.detail?.verified_by_bracket === false ? ' · standings and bracket disagree' : ''}
                  </span>
                </span>
                <span className="font-plex text-[11px] text-white/55">{open ? 'Hide' : 'Standings'}</span>
              </button>
              {open && rows.length > 0 && (
                <ol className="pb-2 pl-[80px] pr-1" aria-label={`${seasonLabel(s.season)} standings`}>
                  {rows.map((r) => (
                    <li key={r.member_id} className="flex items-center gap-2 py-1 font-barlow text-[13px]">
                      <span className="w-6 font-plex text-[11px] text-white/55">{r.rank ?? '–'}</span>
                      <span className="min-w-0 flex-1 truncate text-pressbox-text/90">
                        {r.team_name ?? nameOf(r.member_id)}
                        <span className="text-white/55"> · {nameOf(r.member_id)}</span>
                      </span>
                      <span className="font-plex text-[12px] text-white/70">
                        {r.category_record ?? (r.wins != null ? `${r.wins}-${r.losses ?? 0}${r.ties ? `-${r.ties}` : ''}` : '')}
                      </span>
                      {r.playoff_finish === 1 && <Chip tone="orange">Champ</Chip>}
                      {r.playoff_finish === 2 && <Chip>Final</Chip>}
                    </li>
                  ))}
                </ol>
              )}
              {open && rows.length === 0 && <p className="pb-2 pl-[80px] font-barlow text-[12px] text-white/55">No standings were recorded for this season.</p>}
              {open && history.league?.id && <SeasonDetail leagueId={history.league.id} season={s.season} nameOf={nameOf} />}
            </div>
          );
        })}
      </Panel>

      {/* ---- the league's own awards ---------------------------------------- */}
      {grouped.awards.length > 0 && (
        <Panel testId="history-awards">
          <Eyebrow>✦ League awards</Eyebrow>
          {groupAwards(grouped.awards).map((a, i, arr) => (
            <Row key={a.name} last={i === arr.length - 1}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-condensed font-bold text-[16px] text-pressbox-text">{a.name}</span>
                <span className="block font-barlow text-[12px] text-white/55">
                  {a.winners.map((w) => `${w.season != null ? seasonLabel(w.season) : 'All time'}: ${w.member_id ? nameOf(w.member_id) : w.winner ?? 'Unknown'}`).join(' · ')}
                </span>
              </span>
              {a.winners.some((w) => mine && w.member_id === mine) && <Chip tone="orange">You</Chip>}
            </Row>
          ))}
        </Panel>
      )}

      {/* ---- record book --------------------------------------------------- */}
      {grouped.record.length > 0 && (
        <Panel testId="history-records">
          <Eyebrow>✦ Record book</Eyebrow>
          {grouped.record.map((t, i) => <TrophyRow key={t.id} t={t} nameOf={nameOf} last={i === grouped.record.length - 1} mine={mine} />)}
        </Panel>
      )}

      {/* ---- managers ----------------------------------------------------- */}
      <Panel testId="history-managers">
        <Eyebrow>✦ Managers · {history.members.length}</Eyebrow>
        {[...history.members]
          .sort((a, b) => Number(b.titles ?? 0) - Number(a.titles ?? 0) || Number(b.seasons_played ?? 0) - Number(a.seasons_played ?? 0) || a.display_name.localeCompare(b.display_name))
          .map((m, i, arr) => {
            const career = grouped.career.filter((t) => t.member_id === m.member_id);
            const most = career.find((t) => t.trophy_key === 'most_championships');
            const founding = career.find((t) => t.trophy_key === 'founding_member');
            const drought = career.find((t) => t.trophy_key === 'championship_drought');
            return (
              <Row key={m.member_id} last={i === arr.length - 1}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-condensed font-bold text-[16px] text-pressbox-text">{m.display_name}</span>
                    {m.member_id === mine && <Chip tone="orange">You</Chip>}
                    {!m.owner_id && <Chip>Unclaimed</Chip>}
                    {most && <Chip tone="sage">Most titles</Chip>}
                    {founding && <Chip>Founder</Chip>}
                  </span>
                  <span className="block truncate font-barlow text-[12px] text-white/55">
                    {[careerLine(m), drought && Number(drought.value) >= 3 ? `${drought.value} seasons without a title` : null].filter(Boolean).join(' · ') || 'No seasons recorded'}
                  </span>
                </span>
                <span className="shrink-0 text-right font-plex text-[12px] text-white/60">
                  {m.career_wins != null ? `${m.career_wins}-${m.career_losses ?? 0}${Number(m.career_ties) > 0 ? `-${m.career_ties}` : ''}` : ''}
                </span>
              </Row>
            );
          })}
      </Panel>
    </div>
  );
}

function TrophyRow({ t, nameOf, last, mine }: { t: Trophy; nameOf: (id: string | null | undefined) => string; last: boolean; mine: string | null }) {
  const label = trophyLabel(t);
  const line = trophyValueLine(t, nameOf);
  return (
    <Row last={last}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-condensed font-bold text-[15px] text-pressbox-text">{label.title}</span>
          {t.source === 'computed' && <span className="font-plex text-[9px] tracking-[0.1em] uppercase text-white/55">Citrus computed</span>}
        </span>
        <span className="block truncate font-barlow text-[12px] text-white/55">
          {nameOf(t.member_id)}
          {t.member_id === mine ? ' (you)' : ''}
          {line ? ` · ${line}` : ''}
        </span>
      </span>
      {t.rank != null && t.rank > 1 && <span className="font-plex text-[11px] text-white/55">{ordinal(t.rank)}</span>}
    </Row>
  );
}
