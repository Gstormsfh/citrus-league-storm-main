/**
 * TEAM ANALYTICS, THE PHONE (PR10m, 2026-09-04)
 *
 * No artboard. The page has three honest things to say -- the roster's
 * projection against what it produced, the goalies nobody owns, and the
 * skaters whose teams play the most this week -- and each one already has a
 * Press Box shape: the player card's note and tiles for the first, the
 * Players page's row and column head for the other two. Nothing is styled
 * here that a sibling screen does not already wear.
 *
 * Presentational. The page computes; this lays out. Every figure arrives as
 * a prop and an absent one renders nothing, never a placeholder.
 */
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ProjectedVsActual, type ProjectedVsActualProps } from '@/components/analytics/ProjectedVsActual';
import { PB_TYPE, PressBoxPlayerRow, PressBoxSectionHead } from '@/components/pressbox';
import { PressBoxSettingGroup, PressBoxSettingRow } from '@/components/pressbox/Settings';

export interface AnalyticsTarget {
  id: number;
  name: string;
  position: string;
  team: string;
  pointsPerGame: number;
  gamesThisWeek: number;
  scheduleAdvantage: boolean;
}

export interface TeamAnalyticsPhoneProps {
  analytics: (Pick<ProjectedVsActualProps, 'totals' | 'players'> & {
    measuredPlayers: number;
    rosterSize: number;
  }) | null;
  targets: AnalyticsTarget[];
  loading: boolean;
  /** The guest banner, when the page is in demo. Rendered above the title. */
  banner?: React.ReactNode;
  className?: string;
}

/** `#` `PLAYER · PTS/GM` `GP · WK` -- the Players page's column head. */
function ColumnHead({ player, figure }: { player: string; figure: string }) {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[22px_1fr_60px] gap-2 px-0.5 pt-3 pb-1 font-plex font-medium text-[9px] tracking-[0.06em] text-pressbox-text/40"
    >
      <span>#</span>
      <span>{player}</span>
      <span className="text-right">{figure}</span>
    </div>
  );
}

function TargetRow({ t, rank, onPress }: { t: AnalyticsTarget; rank: number; onPress: () => void }) {
  // A goalie has no points line: the directory's `points` is skater
  // scoring, and the 09-01 card printed his "0.0 Avg Pts" as if it meant
  // something. He is ranked by games this week; that is the figure he gets.
  const isGoalie = t.position === 'G';
  return (
    <PressBoxPlayerRow
      player={{
        id: t.id,
        name: t.name,
        teamAbbreviation: t.team,
        position: t.position,
        note: t.scheduleAdvantage ? 'FULL WEEK' : undefined,
      }}
      rank={rank}
      seasonLine={isGoalie ? null : `${t.pointsPerGame.toFixed(1)} PTS/GM`}
      figure={String(t.gamesThisWeek)}
      action="none"
      onPress={onPress}
    />
  );
}

const EMPTY = 'mt-3 py-4 text-center font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45';
const LIST = 'mt-1 rounded-[12px] bg-pressbox-tile border border-white/[0.08] px-2.5';

export function TeamAnalyticsPhone({ analytics, targets, loading, banner, className }: TeamAnalyticsPhoneProps) {
  const navigate = useNavigate();
  const goalies = targets.filter((p) => p.position === 'G');
  const skaters = targets.filter((p) => p.position !== 'G' && p.gamesThisWeek >= 3).slice(0, 5);
  const toWire = () => navigate('/free-agents');

  return (
    <div
      className={cn(PB_TYPE, 'lg:hidden bg-pressbox-surface text-pressbox-text px-3.5 pt-3 pb-app-chrome', className)}
      data-testid="team-analytics-phone"
    >
      {banner && <div className="mb-3">{banner}</div>}

      <h1 className="font-condensed font-extrabold text-[24px] uppercase tracking-[0.02em] leading-none">Analytics</h1>
      <p className="mt-1.5 font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45">
        How your roster is tracking · who to add next
      </p>

      {analytics && analytics.measuredPlayers > 0 && (
        <>
          <ProjectedVsActual className="mt-4" totals={analytics.totals} players={analytics.players} />
          <p className="mt-2 px-0.5 font-plex font-medium text-[9px] tracking-[0.06em] uppercase text-pressbox-text/40">
            Measured across {analytics.measuredPlayers} of {analytics.rosterSize} rostered players
          </p>
        </>
      )}

      <PressBoxSettingGroup className="mt-4">
        <PressBoxSettingRow
          label="Positional grades"
          help="Offense, peripherals, goaltending and depth"
          value="Roster"
          onPress={() => navigate('/roster')}
          last
        />
      </PressBoxSettingGroup>

      <PressBoxSectionHead className="mt-6" title="Goalies on the wire" count={goalies.length ? goalies.length : null} />
      <p className="mt-1 font-barlow text-[12px] text-pressbox-text/55">Available goalies, ranked by games this week.</p>
      {goalies.length === 0 ? (
        <p className={EMPTY}>{loading ? 'Loading…' : 'No goalie targets surfaced yet'}</p>
      ) : (
        <div className={LIST} data-testid="analytics-goalies">
          <ColumnHead player="PLAYER" figure="GP · WK" />
          {goalies.map((g, i) => (
            <TargetRow key={g.id} t={g} rank={i + 1} onPress={toWire} />
          ))}
        </div>
      )}

      <PressBoxSectionHead
        className="mt-6"
        title="Schedule maximizers"
        count={skaters.length ? skaters.length : null}
        action={
          <button
            type="button"
            onClick={() => navigate('/free-agents?tab=schedule')}
            className="focus-citrus font-plex font-semibold text-[10px] tracking-[0.1em] text-pressbox-orange-soft"
          >
            ALL TRENDS ›
          </button>
        }
      />
      <p className="mt-1 font-barlow text-[12px] text-pressbox-text/55">Free agents with three or more games this week.</p>
      {loading ? (
        <p className={EMPTY}>Loading schedule data…</p>
      ) : skaters.length === 0 ? (
        <p className={EMPTY}>Nobody on the wire has three games this week</p>
      ) : (
        <div className={LIST} data-testid="analytics-maximizers">
          <ColumnHead player="PLAYER · PTS/GM" figure="GP · WK" />
          {skaters.map((s, i) => (
            <TargetRow key={s.id} t={s} rank={i + 1} onPress={toWire} />
          ))}
        </div>
      )}
    </div>
  );
}

export default TeamAnalyticsPhone;
