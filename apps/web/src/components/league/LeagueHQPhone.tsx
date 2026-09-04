/**
 * LEAGUE HQ ON A PHONE — artboard 1a, the LEAGUE tab.
 *
 * Under the league header: this week's matchups, then the tile grid. The
 * PAGE (LeagueDashboard, 2,100 lines) owns the league, the teams, the
 * settings sheet and the draft's state; this owns the layout, so it can be
 * rendered by the harness with the artboard's six teams and by the page with
 * a real league, and be the same component both times.
 *
 * WHAT THE ARTBOARD DRAWS
 *   * `MATCHUPS` with `WEEK 1 ›` hard right, three matchup cards, `+ 3 MORE
 *     MATCHUPS`. The cards carry what the scoreboard read returns — the two
 *     names and the two scores; win chance and games-left are simulations
 *     the app does not run, and `PressBoxLeagueMatchupCard` draws nothing
 *     for a figure it is not given.
 *   * A 2-column grid of dense tiles, each with the one live number that
 *     says whether to open it. The artboard's ten tiles include six with no
 *     page (`leagueMenuTiles.ts` says which); the grid draws the ones that
 *     route, and the page's own actions — the roster, the GM office, the
 *     commissioner's settings sheet — which the old HQ carried as cards.
 *
 * WHAT IS NOT DRAWN, AND WHY
 *   * A week, in the offseason. `THERE IS NO WEEK` (LeagueDashboard,
 *     2026-09-02): between June and late September there is no fantasy
 *     week to show matchups for, so the section says when the season opens
 *     instead of drawing an empty list under a week number.
 *   * The draft, once it is done. Before that it is the screen's #1 action
 *     and takes the top slot as an orange verb — the same CTA, the same
 *     states, the same route (`/draft-v2/:leagueId`, pinned by
 *     leagueDraftEntryGuard) as the card it replaces.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { PressBoxLeagueMatchupCard, type PressBoxLeagueMatchupSide } from '@/components/pressbox/LeagueMatchupCard';
import { PressBoxTile, type PressBoxTileProps } from '@/components/pressbox/Tile';

export interface LeagueHQMatchup {
  id: string;
  home: PressBoxLeagueMatchupSide;
  away: PressBoxLeagueMatchupSide;
  to: string;
}

export interface LeagueHQTeam {
  id: string;
  name: string;
  /** `@derekv`, or the owner's name. */
  owner?: string | null;
  rosterCount?: number | null;
  isYou?: boolean;
  to?: string;
}

export interface LeagueHQDraftCta {
  /** `Join draft room`, `Go to draft room`, `Enter draft lobby`. */
  label: string;
  /** Orange when pressing it is the next real action; otherwise a ghost. */
  hot: boolean;
  description: string;
  to: string;
  onPress?: () => void;
  /** Under the button: `You'll be able to participate once…` */
  note?: string | null;
  /** The practice room, while the draft has not started. */
  mock?: { label: string; to: string; note: string } | null;
}

export interface LeagueHQPhoneProps {
  /** `WEEK 1` and the link behind it; null when there is no week. */
  week?: { number: number; to: string } | null;
  /** In the offseason: `Sep 29`. Replaces the matchup list. */
  seasonOpensOn?: string | null;
  /** `undefined` while loading, `[]` when the week has none. */
  matchups?: LeagueHQMatchup[];
  /** How many of `matchups` to draw before `+ N MORE`. */
  matchupsShown?: number;
  draft?: LeagueHQDraftCta | null;
  tiles: PressBoxTileProps[];
  teams?: LeagueHQTeam[];
  /** Under the teams: the commissioner's invite control. */
  invite?: ReactNode;
  className?: string;
}

export function LeagueHQPhone({
  week = null,
  seasonOpensOn = null,
  matchups,
  matchupsShown = 3,
  draft = null,
  tiles,
  teams,
  invite,
  className,
}: LeagueHQPhoneProps) {
  // Yours first — it is the one card you came for — then the week's order.
  const ordered = matchups
    ? [...matchups].sort(
        (a, b) => Number(!!(b.home.isYou || b.away.isYou)) - Number(!!(a.home.isYou || a.away.isYou)),
      )
    : undefined;
  const shown = ordered?.slice(0, matchupsShown) ?? [];
  const more = ordered ? ordered.length - shown.length : 0;

  return (
    <div className={cn(PB_TYPE, 'flex flex-col gap-3 px-3 pt-3 border-t border-white/[0.08]', className)} data-testid="league-hq-phone">
      {draft && (
        <section
          className={cn(
            'rounded-[12px] p-3.5 bg-pressbox-tile border',
            draft.hot ? 'border-pressbox-orange/35' : 'border-white/[0.08]',
          )}
          data-testid="league-hq-draft"
        >
          <p className="font-plex font-semibold text-[9px] uppercase tracking-[0.12em] text-pressbox-orange-soft">
            Draft
          </p>
          <p className="mt-1 font-barlow text-[13px] leading-[1.35] text-pressbox-text/80">{draft.description}</p>
          <Link
            to={draft.to}
            onClick={draft.onPress}
            className={cn(
              'focus-citrus mt-3 flex items-center justify-center h-[44px] rounded-[10px]',
              'font-condensed font-bold text-[14px] uppercase tracking-[0.1em]',
              draft.hot
                ? 'bg-pressbox-orange text-pressbox-orange-ink'
                : 'border border-white/15 text-pressbox-text',
            )}
          >
            {draft.label}
          </Link>
          {draft.note && (
            <p className="mt-2 text-center font-plex font-medium text-[10px] text-pressbox-text/45">{draft.note}</p>
          )}
          {draft.mock && (
            <div className="mt-3 pt-3 border-t border-white/[0.08]">
              <Link
                to={draft.mock.to}
                className="focus-citrus block text-center font-plex font-semibold text-[10px] uppercase tracking-[0.08em] text-pressbox-orange-soft"
              >
                {draft.mock.label}
              </Link>
              <p className="mt-1 text-center font-plex font-medium text-[10px] text-pressbox-text/45">{draft.mock.note}</p>
            </div>
          )}
        </section>
      )}

      <PressBoxSectionHead
        title="Matchups"
        action={
          week ? (
            <Link to={week.to} className="focus-citrus font-plex font-medium text-[11px] text-pressbox-orange-soft">
              WEEK {week.number} &rsaquo;
            </Link>
          ) : undefined
        }
      />

      {!week ? (
        <p className="font-plex font-medium text-[10px] text-pressbox-text/45" data-testid="league-hq-no-week">
          {seasonOpensOn
            ? `Season opens ${seasonOpensOn} · week 1 matchups post then`
            : draft
              ? 'Matchups post once the draft is done'
              : 'No matchups yet'}
        </p>
      ) : matchups === undefined ? (
        <div className="flex flex-col gap-1.5" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[64px] rounded-[12px] bg-pressbox-tile border border-white/[0.08] opacity-50" />
          ))}
        </div>
      ) : matchups.length === 0 ? (
        <p className="font-plex font-medium text-[10px] text-pressbox-text/45" data-testid="league-hq-no-matchups">
          No matchups posted for week {week.number}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {shown.map((m) => (
              <PressBoxLeagueMatchupCard key={m.id} home={m.home} away={m.away} to={m.to} />
            ))}
          </div>
          {more > 0 && (
            <Link
              to={week.to}
              className="focus-citrus text-center font-plex font-medium text-[11px] text-pressbox-text/45"
            >
              + {more} MORE {more === 1 ? 'MATCHUP' : 'MATCHUPS'}
            </Link>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2" data-testid="league-hq-tiles">
        {tiles.map((t) => (
          <PressBoxTile key={t.title} {...t} dense />
        ))}
      </div>

      {teams && teams.length > 0 && (
        <section className="mt-1">
          <PressBoxSectionHead title="Teams" count={teams.length} />
          <ol className="mt-1.5 border-b border-white/[0.06]" data-testid="league-hq-teams">
            {teams.map((t) => {
              const inner = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-[30px] h-[30px] flex-none rounded-full flex items-center justify-center font-condensed font-bold text-[11px] text-pressbox-text',
                      t.isYou ? 'bg-pressbox-orange/20 border-2 border-pressbox-orange' : 'bg-[#2a3a30]',
                    )}
                  >
                    {(t.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-barlow font-bold text-[13px] text-pressbox-text">
                      {t.name}
                      {t.isYou && <span className="ml-1.5 font-plex font-semibold text-[9px] text-pressbox-orange-soft">YOU</span>}
                    </span>
                    <span className="block truncate font-plex font-medium text-[10px] text-pressbox-text/50">
                      {[t.owner, t.rosterCount != null ? `${t.rosterCount} players` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </>
              );
              const cls = 'flex items-center gap-2.5 min-h-[44px] py-1 border-t border-white/[0.06]';
              return (
                <li key={t.id}>
                  {t.to ? (
                    <Link to={t.to} className={cn(cls, 'focus-citrus')}>
                      {inner}
                    </Link>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
          {invite && <div className="mt-3">{invite}</div>}
        </section>
      )}
    </div>
  );
}

export default LeagueHQPhone;
