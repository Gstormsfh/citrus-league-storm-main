/**
 * What the reader saw, on a screen with edit boxes, before anything is
 * written. One card per screenshot: what kind of page it is, which season,
 * how sure the reader was and what it wants checked, then the rows as a
 * table the commissioner can correct. The season is the one thing a page
 * cannot go without; a card with no season is marked and blocks the import
 * until it has one.
 */
import { useMemo, useState } from 'react';
import type { AwardRow, ChampionRow, DraftPickRow, ImportPlatform, KeeperRow, PageKind, PickOwnershipRow, PlayoffRow, ScreenshotPage, StandingsRow, TransactionRow } from '@/api/imports';
import { seasonLabel } from '../trophyLabels';
import { Chip, Eyebrow, HistoryButton, inputClass } from '../ui';
import { EditableTable, type Column } from './EditableTable';
import { KIND_LABEL, ROW_SEASON_KINDS, SEASONLESS_KINDS, seasonsIn } from './reviewHelpers';
import { pageNameFor } from './pageGuide';

const CHAMPIONS: Array<Column<ChampionRow & Record<string, unknown>>> = [
  { key: 'season', label: 'Season (start year)', kind: 'int', width: 'w-24' }, { key: 'championTeam', label: 'Champion', kind: 'text', width: 'w-44' }, { key: 'championManager', label: 'Manager', kind: 'text', width: 'w-32' },
  { key: 'runnerUpTeam', label: 'Runner-up', kind: 'text', width: 'w-44' }, { key: 'runnerUpManager', label: 'Manager', kind: 'text', width: 'w-32' }, { key: 'note', label: 'Note', kind: 'text', width: 'w-40' },
];
const AWARDS: Array<Column<AwardRow & Record<string, unknown>>> = [
  { key: 'season', label: 'Season (start year)', kind: 'int', width: 'w-24' }, { key: 'award', label: 'Award', kind: 'text', width: 'w-44' },
  { key: 'winnerTeam', label: 'Winning team', kind: 'text', width: 'w-40' }, { key: 'winnerManager', label: 'Winning manager', kind: 'text', width: 'w-32' }, { key: 'note', label: 'Note', kind: 'text', width: 'w-40' },
];
const STANDINGS: Array<Column<StandingsRow & Record<string, unknown>>> = [
  { key: 'rank', label: 'Rank', kind: 'int', width: 'w-12' }, { key: 'teamName', label: 'Team', kind: 'text', width: 'w-44' }, { key: 'managerName', label: 'Manager', kind: 'text', width: 'w-32' },
  { key: 'wins', label: 'W', kind: 'int', width: 'w-12' }, { key: 'losses', label: 'L', kind: 'int', width: 'w-12' }, { key: 'ties', label: 'T', kind: 'int', width: 'w-12' },
  { key: 'pointsFor', label: 'PF', kind: 'num', width: 'w-20' }, { key: 'pointsAgainst', label: 'PA', kind: 'num', width: 'w-20' }, { key: 'isChampion', label: 'Champ', kind: 'bool', width: 'w-14' },
];
const PLAYOFFS: Array<Column<PlayoffRow & Record<string, unknown>>> = [
  { key: 'round', label: 'Round', kind: 'select', options: ['final', 'third_place', 'semifinal', 'quarterfinal', 'consolation', 'other'], width: 'w-32' }, { key: 'week', label: 'Week', kind: 'int', width: 'w-14' },
  { key: 'homeTeam', label: 'Home', kind: 'text', width: 'w-40' }, { key: 'awayTeam', label: 'Away', kind: 'text', width: 'w-40' },
  { key: 'homeScore', label: 'Home pts', kind: 'num', width: 'w-20' }, { key: 'awayScore', label: 'Away pts', kind: 'num', width: 'w-20' }, { key: 'winner', label: 'Winner', kind: 'select', options: ['home', 'away', 'tie'], width: 'w-20' },
];
const DRAFT: Array<Column<DraftPickRow & Record<string, unknown>>> = [
  { key: 'overall', label: 'Pick', kind: 'int', width: 'w-12' }, { key: 'round', label: 'Rd', kind: 'int', width: 'w-12' }, { key: 'teamName', label: 'Team', kind: 'text', width: 'w-40' },
  { key: 'playerName', label: 'Player', kind: 'text', width: 'w-40' }, { key: 'playerTeamAbbr', label: 'NHL', kind: 'text', width: 'w-14' }, { key: 'position', label: 'Pos', kind: 'text', width: 'w-14' }, { key: 'isKeeper', label: 'Keeper', kind: 'bool', width: 'w-14' },
];
const TRANSACTIONS: Array<Column<TransactionRow & Record<string, unknown>>> = [
  { key: 'date', label: 'Date', kind: 'text', width: 'w-28' }, { key: 'type', label: 'Type', kind: 'select', options: ['add', 'drop', 'trade', 'waiver', 'commish', 'keeper', 'unknown'], width: 'w-24' },
  { key: 'teamName', label: 'To', kind: 'text', width: 'w-36' }, { key: 'counterpartyTeamName', label: 'From', kind: 'text', width: 'w-36' },
  { key: 'playerName', label: 'Player', kind: 'text', width: 'w-36' }, { key: 'playerTeamAbbr', label: 'NHL', kind: 'text', width: 'w-14' },
  { key: 'pickSeason', label: 'Pick year', kind: 'int', width: 'w-20' }, { key: 'pickRound', label: 'Pick rd', kind: 'int', width: 'w-16' },
];
const KEEPERS: Array<Column<KeeperRow & Record<string, unknown>>> = [
  { key: 'teamName', label: 'Team', kind: 'text', width: 'w-40' }, { key: 'playerName', label: 'Player', kind: 'text', width: 'w-40' }, { key: 'playerTeamAbbr', label: 'NHL', kind: 'text', width: 'w-14' },
  { key: 'position', label: 'Pos', kind: 'text', width: 'w-14' }, { key: 'round', label: 'Costs rd', kind: 'int', width: 'w-16' }, { key: 'roundNext', label: 'Next yr', kind: 'int', width: 'w-16' }, { key: 'yearsKept', label: 'Years', kind: 'int', width: 'w-14' },
];
const PICKS: Array<Column<PickOwnershipRow & Record<string, unknown>>> = [
  { key: 'draftSeason', label: 'Draft year', kind: 'int', width: 'w-20' }, { key: 'round', label: 'Round', kind: 'int', width: 'w-16' },
  { key: 'originalTeamName', label: 'Originally', kind: 'text', width: 'w-44' }, { key: 'ownerTeamName', label: 'Now owned by', kind: 'text', width: 'w-44' },
];

export interface ScreenshotReviewProps {
  pages: ScreenshotPage[];
  previews: string[];
  platform: ImportPlatform;
  onChange: (pages: ScreenshotPage[]) => void;
  onConfirm: (opts: { finished: Record<string, boolean>; rostersAsKeepers: boolean }) => Promise<void>;
  onBack: () => void;
  busy?: boolean;
}

export function ScreenshotReview({ pages, previews, platform, onChange, onConfirm, onBack, busy }: ScreenshotReviewProps) {
  const [finished, setFinished] = useState<Record<string, boolean>>({});
  const [rostersAsKeepers, setRostersAsKeepers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seasons = useMemo(() => seasonsIn(pages), [pages]);
  const live = pages.filter((p) => p.kind !== 'other');
  const missingSeason = live.filter((p) => p.season == null && !SEASONLESS_KINDS.includes(p.kind));
  const hasRosters = live.some((p) => p.kind === 'roster' && p.roster?.length);
  const currentYear = new Date().getUTCFullYear();

  const setPage = (i: number, patch: Partial<ScreenshotPage>) => onChange(pages.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const confirm = async () => {
    setError(null);
    if (missingSeason.length) { setError(`Set the season on image ${missingSeason[0].index + 1} first.`); return; }
    if (!seasons.length) { setError('Nothing here carries a season of history yet.'); return; }
    try {
      await onConfirm({ finished, rostersAsKeepers });
    } catch (e) {
      setError((e as Error).message || 'That import did not start. Try again.');
    }
  };

  return (
    <div data-testid="screenshot-review" className="space-y-3">
      <div>
        <Eyebrow>✦ Check what was read</Eyebrow>
        <p className="mt-1 font-condensed font-bold text-[16px] text-pressbox-text">{live.length} {live.length === 1 ? 'page' : 'pages'}{seasons.length ? ` · ${seasons.map(seasonLabel).join(', ')}` : ''}</p>
        <p className="mt-0.5 font-barlow text-[12px] text-white/55">Fix anything the reader got wrong. Nothing is written until you import.</p>
      </div>

      {pages.map((page, i) => (
        <section key={i} className="rounded-[12px] bg-white/[0.03] ring-1 ring-white/[0.06] p-3" data-testid={`page-card-${i}`}>
          <div className="flex flex-wrap items-start gap-2">
            {previews[page.index] && <img src={previews[page.index]} alt={`Screenshot ${page.index + 1}`} className="h-16 w-12 shrink-0 rounded-[6px] object-cover object-top ring-1 ring-white/10" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-plex font-semibold text-[10px] uppercase tracking-[0.12em] text-white/55">Image {page.index + 1}</span>
                {page.platform !== 'unknown' && <Chip>{page.platform}</Chip>}
                {pageNameFor(platform, page.kind) && page.kind !== 'other' && <span className="font-barlow text-[12px] text-white/55">{pageNameFor(platform, page.kind)}</span>}
                {page.confidence !== 'high' && <Chip tone={page.confidence === 'low' ? 'grapefruit' : 'cream'}>{page.confidence === 'low' ? 'Check closely' : 'Worth a look'}</Chip>}
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:max-w-md">
                <label className="block">
                  <span className="sr-only">Page kind for image {page.index + 1}</span>
                  <select value={page.kind} onChange={(e) => setPage(i, { kind: e.target.value as PageKind })} className={inputClass} aria-label={`Page kind for image ${page.index + 1}`}>
                    {(Object.keys(KIND_LABEL) as PageKind[]).map((k) => <option key={k} value={k} className="text-black">{KIND_LABEL[k]}</option>)}
                  </select>
                </label>
                {!ROW_SEASON_KINDS.includes(page.kind) && <label className="block">
                  <span className="sr-only">Season for image {page.index + 1}</span>
                  <input
                    aria-label={`Season for image ${page.index + 1}`}
                    inputMode="numeric"
                    placeholder="Season start year, like 2023"
                    value={page.season ?? ''}
                    onChange={(e) => { const n = Number(e.target.value); setPage(i, { season: /^\d{4}$/.test(e.target.value) && n >= 1990 && n <= currentYear + 1 ? n : null }); }}
                    className={inputClass}
                  />
                </label>}
              </div>
              {page.season != null && !ROW_SEASON_KINDS.includes(page.kind) && <p className="mt-1 font-barlow text-[12px] text-white/55">{seasonLabel(page.season)} season</p>}
              {ROW_SEASON_KINDS.includes(page.kind) && <p className="mt-1 font-barlow text-[12px] text-white/55">Each row carries its own season.</p>}
              {page.season == null && page.kind !== 'other' && !SEASONLESS_KINDS.includes(page.kind) && (
                <p className="mt-1 font-barlow text-[12px] text-pressbox-grapefruit-text" role="alert">Which season is this page? Type the start year.</p>
              )}
              {page.notes && <p className="mt-1 font-barlow text-[12px] text-white/60">Reader's note: {page.notes}</p>}
            </div>
            <button type="button" onClick={() => onChange(pages.filter((_, j) => j !== i))} className="font-barlow text-[12px] text-white/55">Remove</button>
          </div>

          {page.kind === 'champions' && (
            <EditableTable label={`Champions on image ${page.index + 1}`} columns={CHAMPIONS} rows={(page.champions ?? []) as Array<ChampionRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { champions: rows })} blank={() => ({ season: currentYear - 1, championTeam: '' })} />
          )}
          {page.kind === 'awards' && (
            <EditableTable label={`Awards on image ${page.index + 1}`} columns={AWARDS} rows={(page.awards ?? []) as Array<AwardRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { awards: rows })} blank={() => ({ award: '' })} />
          )}
          {page.kind === 'standings' && (
            <EditableTable label={`Standings on image ${page.index + 1}`} columns={STANDINGS} rows={(page.standings ?? []) as Array<StandingsRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { standings: rows })} blank={() => ({ teamName: '' })} />
          )}
          {page.kind === 'playoffs' && (
            <EditableTable label={`Playoffs on image ${page.index + 1}`} columns={PLAYOFFS} rows={(page.playoffs ?? []) as Array<PlayoffRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { playoffs: rows })} blank={() => ({ round: 'other' as const, homeTeam: '' })} />
          )}
          {page.kind === 'draft' && (
            <EditableTable label={`Draft on image ${page.index + 1}`} columns={DRAFT} rows={(page.picks ?? []) as Array<DraftPickRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { picks: rows })} blank={() => ({ teamName: '', playerName: '' })} />
          )}
          {page.kind === 'transactions' && (
            <EditableTable label={`Transactions on image ${page.index + 1}`} columns={TRANSACTIONS} rows={(page.transactions ?? []) as Array<TransactionRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { transactions: rows })} blank={() => ({ type: 'trade' as const, teamName: '' })} />
          )}
          {page.kind === 'keepers' && (
            <EditableTable label={`Keepers on image ${page.index + 1}`} columns={KEEPERS} rows={(page.keepers ?? []) as Array<KeeperRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { keepers: rows })} blank={() => ({ teamName: '', playerName: '' })} />
          )}
          {page.kind === 'pick_ownership' && (
            <EditableTable label={`Traded picks on image ${page.index + 1}`} columns={PICKS} rows={(page.pickOwnership ?? []) as Array<PickOwnershipRow & Record<string, unknown>>} onChange={(rows) => setPage(i, { pickOwnership: rows })} blank={() => ({ draftSeason: currentYear, round: 1, originalTeamName: '', ownerTeamName: '' })} />
          )}
          {page.kind === 'roster' && (
            <ul className="mt-2 space-y-1 font-barlow text-[13px] text-white/70">
              {(page.roster ?? []).map((t, k) => <li key={k}><span className="text-pressbox-text">{t.teamName}</span> · {t.players.length} players: {t.players.map((p) => p.playerName).join(', ')}</li>)}
            </ul>
          )}
          {page.kind === 'settings' && page.settings && (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-barlow text-[13px] text-white/70 sm:grid-cols-3">
              <dt className="text-white/55">Format</dt><dd className="text-pressbox-text">{page.settings.scoringType ?? 'not shown'}</dd>
              {page.settings.categories?.length ? <><dt className="text-white/55">Categories</dt><dd className="text-pressbox-text col-span-2">{page.settings.categories.join(', ')}</dd></> : null}
              {page.settings.pointValues?.length ? <><dt className="text-white/55">Points</dt><dd className="text-pressbox-text col-span-2">{page.settings.pointValues.map((p) => `${p.stat} ${p.points}`).join(', ')}</dd></> : null}
              {page.settings.rosterSlots?.length ? <><dt className="text-white/55">Roster</dt><dd className="text-pressbox-text col-span-2">{page.settings.rosterSlots.map((s) => `${s.count} ${s.slot}`).join(', ')}</dd></> : null}
              {page.settings.keeperCount != null && <><dt className="text-white/55">Keepers</dt><dd className="text-pressbox-text">{page.settings.keeperCount}</dd></>}
            </dl>
          )}
          {page.kind === 'scoreboard' && page.scoreboard && (
            <ul className="mt-2 space-y-1 font-barlow text-[13px] text-white/70">
              <li className="text-white/55">Week {page.scoreboard.week}</li>
              {page.scoreboard.matchups.map((m, k) => (
                <li key={k}><span className="text-pressbox-text">{m.homeTeam}</span> {m.homeCatWins != null ? `${m.homeCatWins}-${m.homeCatLosses ?? 0}-${m.homeCatTies ?? 0}` : m.homeScore ?? ''} vs <span className="text-pressbox-text">{m.awayTeam ?? 'bye'}</span> {m.awayScore ?? ''}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {seasons.length > 0 && (
        <section className="rounded-[12px] bg-white/[0.03] ring-1 ring-white/[0.06] p-3" data-testid="review-seasons">
          <Eyebrow>✦ Seasons</Eyebrow>
          <ul className="mt-1.5 space-y-1">
            {seasons.map((s) => {
              const past = s < (new Date().getUTCMonth() >= 6 ? currentYear : currentYear - 1);
              const value = finished[String(s)] ?? past;
              return (
                <li key={s} className="flex items-center justify-between gap-2 font-barlow text-[13px]">
                  <span className="text-pressbox-text">{seasonLabel(s)}</span>
                  <label className="flex items-center gap-2 text-white/70">
                    <input type="checkbox" checked={value} onChange={(e) => setFinished({ ...finished, [String(s)]: e.target.checked })} className="h-4 w-4" aria-label={`${seasonLabel(s)} finished`} />
                    Finished (crown a champion)
                  </label>
                </li>
              );
            })}
          </ul>
          {hasRosters && (
            <label className="mt-2 flex items-center gap-2 font-barlow text-[13px] text-white/70">
              <input type="checkbox" checked={rostersAsKeepers} onChange={(e) => setRostersAsKeepers(e.target.checked)} className="h-4 w-4" />
              Dynasty league: keep whole rosters as keepers
            </label>
          )}
        </section>
      )}

      {error && <p role="alert" className="font-barlow text-[13px] text-pressbox-grapefruit-text">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <HistoryButton busy={busy} disabled={busy || !live.length} onClick={() => void confirm()}>
          {seasons.length ? `Import ${seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'}` : 'Import'}
        </HistoryButton>
        <HistoryButton tone="quiet" onClick={onBack} disabled={busy}>Start over</HistoryButton>
        <span className="font-barlow text-[12px] text-white/55">{platform === 'manual' ? 'Platform: as read from each page' : `Platform: ${platform}`}</span>
      </div>
    </div>
  );
}
