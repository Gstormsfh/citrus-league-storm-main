/**
 * THE PLAYERS TAB ON A PHONE (2026-09-04).
 *
 * The league-wide browser — every player on every team with season
 * actuals, xG, GAR/60 and the rolled-forward projection — as artboard 1a's
 * Players screen draws a list: a search row behind the header's glass, a
 * segmented SKATERS / GOALIES, a chip row of positions with the team and
 * the sort as pickers, a column head, and one row per player carrying the
 * face, the name, `EDM · #97 · C`, and on the right the ONE figure the
 * list is sorted by, in 17px Plex. The old phone rendering was the desktop
 * table scrolled sideways under a sticky name column; a list a thumb can
 * read shows one number per row and lets the sort choose which.
 *
 * A row tap opens the shared player card, the same card every other
 * surface opens — its Detailed tab carries the GAR and xG breakdown the
 * old side panel drew — so the phone has one card, not a second panel.
 *
 * Fifty rows, then `+ N MORE`, the way the Players screen pages.
 */
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxChips } from '@/components/pressbox/Chips';
import { PressBoxSegmented } from '@/components/pressbox/Segmented';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxOptionSheet } from '@/components/pressbox/Settings';
import { pressBoxPositionChipClasses, positionChipKey } from '@/components/pressbox/positionChip';
import { Mug } from '@/components/roster/Mug';
import type { MugPlayer } from '@/components/roster/headshot';
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import { GOALIE_SORTS, SKATER_SORTS, type GoalieSortKey, type SkaterSortKey } from './playersBrowse';

export const PAGE_SIZE = 50;

export interface PlayersBrowsePhoneProps {
  rows: DashboardIndexEntry[];
  total: number;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  group: 'skaters' | 'goalies';
  onGroup: (g: 'skaters' | 'goalies') => void;
  position: string;
  onPosition: (p: string) => void;
  teams: string[];
  team: string;
  onTeam: (t: string) => void;
  skaterSort: SkaterSortKey;
  onSkaterSort: (k: SkaterSortKey) => void;
  goalieSort: GoalieSortKey;
  onGoalieSort: (k: GoalieSortKey) => void;
  searchOpen: boolean;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  onOpen: (p: DashboardIndexEntry) => void;
  className?: string;
}

const POSITIONS = ['ALL', 'C', 'LW', 'RW', 'D'] as const;

const mugOf = (p: DashboardIndexEntry): MugPlayer => ({ name: p.name, image: p.headshot_url, team: p.team });

export function PlayersBrowsePhone({
  rows,
  total,
  loading,
  error,
  onRetry,
  group,
  onGroup,
  position,
  onPosition,
  teams,
  team,
  onTeam,
  skaterSort,
  onSkaterSort,
  goalieSort,
  onGoalieSort,
  searchOpen,
  searchQuery,
  onSearchQuery,
  onOpen,
  className,
}: PlayersBrowsePhoneProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => {
    setShown(PAGE_SIZE);
  }, [group, position, team, skaterSort, goalieSort, searchQuery]);

  const [picker, setPicker] = useState<'team' | 'sort' | null>(null);

  const goalies = group === 'goalies';
  const sorts = goalies ? GOALIE_SORTS : SKATER_SORTS;
  const sort = goalies
    ? GOALIE_SORTS.find((s) => s.key === goalieSort) ?? GOALIE_SORTS[0]
    : SKATER_SORTS.find((s) => s.key === skaterSort) ?? SKATER_SORTS[0];

  const chips = [
    ...(goalies ? [{ key: 'ALL', label: 'ALL' }] : POSITIONS.map((p) => ({ key: p, label: p }))),
    { key: '__team', label: team === 'ALL' ? 'TEAM ▾' : `${team} ▾` },
    { key: '__sort', label: `SORT · ${sort.label} ▾`, trailing: true },
  ];
  const chipActive = goalies ? 'ALL' : position;

  const visible = rows.slice(0, shown);

  return (
    <div data-testid="players-browse-phone" className={cn(PB_TYPE, 'px-3.5', className)}>
      {searchOpen && (
        <div className="mb-2.5 flex items-center gap-2 h-[38px] px-3 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
          <Search className="w-[15px] h-[15px] text-pressbox-text/45" strokeWidth={2} aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            placeholder="Search every player…"
            aria-label="Search players"
            data-testid="players-browse-search"
            className="flex-1 min-w-0 bg-transparent font-barlow text-[14px] text-pressbox-text placeholder:text-pressbox-text/45 outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQuery('')}
              className="focus-citrus font-plex font-semibold text-[9px] tracking-[0.08em] text-pressbox-text/55 uppercase"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <PressBoxSegmented
        label="Skaters or goalies"
        segments={[
          { key: 'skaters', label: 'SKATERS' },
          { key: 'goalies', label: 'GOALIES' },
        ]}
        activeKey={group}
        onSelect={(k) => onGroup(k as 'skaters' | 'goalies')}
      />

      <div className="mt-2.5 -mx-3.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PressBoxChips
          chips={chips}
          activeKey={chipActive}
          onSelect={(k) => {
            if (k === '__team') setPicker('team');
            else if (k === '__sort') setPicker('sort');
            else onPosition(k);
          }}
          label="Player filters"
          outlined
          compact
          className="w-max min-w-full px-3.5"
        />
      </div>

      <PressBoxSectionHead
        className="mt-3.5"
        title={searchQuery ? 'Results' : goalies ? 'Goalies' : 'Skaters'}
        count={!loading && total > 0 ? String(total) : null}
        action={
          <span className="font-plex font-medium text-[10px] tracking-[0.06em] text-pressbox-text/45 uppercase">
            by {sort.label}
          </span>
        }
      />

      {loading ? (
        <div className="mt-2 flex flex-col gap-1.5" data-testid="players-browse-loading">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[56px] rounded-[10px] bg-pressbox-tile border border-white/[0.08] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="mt-2 px-4 py-8 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="players-browse-error">
          <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">The index did not load</p>
          <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="focus-citrus mt-3 px-4 py-2 rounded-full bg-pressbox-text text-pressbox-surface font-plex font-semibold text-[10px] tracking-[0.06em]"
            >
              TRY AGAIN
            </button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-2 px-4 py-8 rounded-[12px] bg-pressbox-tile border border-white/[0.08] text-center" data-testid="players-browse-empty">
          <p className="font-condensed font-bold text-[15px] uppercase tracking-[0.08em] text-pressbox-text/70">No players match</p>
          <p className="mt-1 font-barlow text-[12px] text-pressbox-text/45">Loosen a filter or clear the search.</p>
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-[22px_1fr_44px_64px] gap-2 pt-3 pb-1 px-0.5 font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40"
            aria-hidden="true"
          >
            <span>#</span>
            <span>Player · team · pos</span>
            <span className="text-right">GP</span>
            <span className="text-right">{sort.label}</span>
          </div>
          <ol className="border-b border-white/[0.06]" data-testid="players-browse-list">
            {visible.map((p, i) => (
              <li key={p.id} data-testid="players-browse-row">
                <button
                  type="button"
                  onClick={() => onOpen(p)}
                  aria-label={`Open player card for ${p.name}`}
                  className="focus-citrus grid grid-cols-[22px_1fr_44px_64px] gap-2 items-center w-full min-h-[56px] py-1.5 px-0.5 text-left border-t border-white/[0.06]"
                >
                  <span className="font-plex font-medium text-[10px] tabular-nums text-pressbox-text/45">{i + 1}</span>
                  <span className="flex items-center gap-2 min-w-0">
                    <Mug p={mugOf(p)} size="sm" crest />
                    <span className="min-w-0">
                      <span className="block font-barlow font-bold text-[14px] leading-tight text-pressbox-text truncate">{p.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 font-plex font-medium text-[10px] text-pressbox-text/50 tabular-nums">
                        <span className={cn(pressBoxPositionChipClasses(positionChipKey(p.position)), 'w-auto h-[16px] px-1 text-[9px]')}>
                          {p.position}
                        </span>
                        {p.team}
                        {p.jersey != null && ` · #${p.jersey}`}
                      </span>
                    </span>
                  </span>
                  <span className="font-plex font-medium text-[11px] tabular-nums text-right text-pressbox-text/60">{p.gp}</span>
                  <span
                    className={cn(
                      'font-plex font-semibold text-[17px] tabular-nums text-right leading-none',
                      sort.tone === 'orange' ? 'text-pressbox-orange-soft' : 'text-pressbox-text',
                    )}
                  >
                    {sort.figure(p)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {rows.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE_SIZE)}
              className="focus-citrus mt-2 w-full h-9 rounded-[8px] bg-white/[0.04] border border-white/[0.08] font-plex font-semibold text-[10px] tracking-[0.08em] text-pressbox-text/60"
            >
              + {Math.min(PAGE_SIZE, rows.length - shown)} MORE · {rows.length - shown} LEFT
            </button>
          )}
        </>
      )}

      {picker === 'team' && (
        <PressBoxOptionSheet
          open
          onOpenChange={(o) => !o && setPicker(null)}
          title="Team"
          help="Every player on one club"
          options={[{ value: 'ALL', label: 'All teams' }, ...teams.map((t) => ({ value: t, label: t }))]}
          value={team}
          onSelect={onTeam}
        />
      )}
      {picker === 'sort' && (
        <PressBoxOptionSheet
          open
          onOpenChange={(o) => !o && setPicker(null)}
          title="Sort by"
          help="The figure each row shows"
          options={sorts.map((s) => ({ value: s.key, label: s.label, help: s.help }))}
          value={sort.key}
          onSelect={(v) => (goalies ? onGoalieSort(v as GoalieSortKey) : onSkaterSort(v as SkaterSortKey))}
        />
      )}
    </div>
  );
}

export default PlayersBrowsePhone;
