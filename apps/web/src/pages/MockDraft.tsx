/**
 * THE MOCK DRAFT IS A REAL DRAFT (2026-09-14).
 *
 * This is the front door for a signed-in manager who wants to rehearse:
 * pick the seat count and the clock, press Start, and land in the live V2
 * room with every other seat filled by AI. It inherits a league's size,
 * rounds, roster slots and scoring, so the mock scores the way the season
 * will: the league in `?league=<id>` when opened from one, otherwise the
 * manager's active league when they are in one. Only a manager with no
 * league drafts against Citrus default scoring, and a manager who wants
 * that anyway can choose it.
 *
 * It replaces the Armchair GM simulator as the destination for every
 * signed-in mock-draft affordance. The simulator stays where the marketing
 * pages promise "no account needed"; a signed-in manager never sees it.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { PressBoxSegmented } from '@/components/pressbox/Segmented';
import { PB_TYPE } from '@/components/pressbox/rowScale';
import { cn } from '@/lib/utils';
import { useStartMockDraft } from '@/hooks/useStartMockDraft';
import { useLeague } from '@/contexts/LeagueContext';
import {
  PRACTICE_DRAFT_DEFAULT_PICK_SECONDS,
  PRACTICE_DRAFT_DEFAULT_ROUNDS,
  PRACTICE_DRAFT_DEFAULT_TEAM_COUNT,
} from '@citrus/shared';

const SEATS = [8, 10, 12, 14, 16];
const CLOCKS = [30, 60, 90];

export default function MockDraft() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { userLeagues, activeLeague } = useLeague();
  const fromLeagueId = searchParams.get('league');
  const [useDefaults, setUseDefaults] = useState(false);
  // The league to rehearse: the one in the URL, else the active one. The
  // scoring a manager sees in a mock is their league's unless they have
  // none or say otherwise.
  const fromLeague = useMemo(() => {
    if (useDefaults) return null;
    const byParam = fromLeagueId ? userLeagues.find((l) => l.id === fromLeagueId) ?? null : null;
    return byParam ?? activeLeague ?? null;
  }, [useDefaults, userLeagues, fromLeagueId, activeLeague]);
  const [teamsCount, setTeamsCount] = useState(PRACTICE_DRAFT_DEFAULT_TEAM_COUNT);
  const [pickSeconds, setPickSeconds] = useState(PRACTICE_DRAFT_DEFAULT_PICK_SECONDS);
  const { start, starting } = useStartMockDraft();

  // league_size is the one owner of truth for seats (lib/draftReadiness); the
  // server re-reads it, this is only for the sentence on the button.
  const sourceSize = (fromLeague as { league_size?: number | null } | null)?.league_size ?? null;
  const aiSeats = (sourceSize ?? teamsCount) - 1;

  return (
    <div className={cn(PB_TYPE, 'min-h-screen bg-pressbox-surface text-pressbox-text')}>
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]">
        <PressBoxAppHeader title="Mock draft" logoSrc="/favicon.svg" onBack={() => navigate(-1)} />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-3.5 pb-app-chrome lg:pt-app-header lg:pb-8">
        <p className="mt-4 font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45">
          Same room, same engine, same clock
        </p>
        <h1 className="mt-1 font-barlow font-bold text-[26px] leading-tight">
          {fromLeague ? `Rehearse the ${fromLeague.name} draft` : 'Run a mock draft'}
        </h1>
        <p className="mt-2 text-[14px] text-pressbox-text/70 leading-relaxed">
          {fromLeague
            ? `Your league's size, rounds, roster slots and scoring. You take one seat; ${aiSeats} AI managers take the rest. Nothing here counts.`
            : 'You take one seat; AI managers take the rest and draft the moment they are on the clock. Nothing here counts, and the seats reset next time.'}
        </p>

        {!fromLeague && (
          <div className="mt-6 space-y-5">
            <div>
              <p className="font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45 mb-2">Teams</p>
              <PressBoxSegmented
                label="Teams in the mock draft"
                segments={SEATS.map((n) => ({ key: String(n), label: String(n) }))}
                activeKey={String(teamsCount)}
                onSelect={(k) => setTeamsCount(Number(k))}
              />
            </div>
            <div>
              <p className="font-plex font-medium text-[10px] tracking-[0.06em] uppercase text-pressbox-text/45 mb-2">Clock per pick</p>
              <PressBoxSegmented
                label="Seconds per pick"
                segments={CLOCKS.map((n) => ({ key: String(n), label: `${n}s` }))}
                activeKey={String(pickSeconds)}
                onSelect={(k) => setPickSeconds(Number(k))}
              />
            </div>
            <p className="text-[12px] text-pressbox-text/55">{PRACTICE_DRAFT_DEFAULT_ROUNDS} rounds, snake order, default scoring.</p>
          </div>
        )}

        <button
          type="button"
          disabled={starting}
          onClick={() => void start(fromLeague
            ? { fromLeagueId: fromLeague.id, pickTimeLimitSeconds: pickSeconds }
            : { teamsCount, pickTimeLimitSeconds: pickSeconds })}
          className="mt-8 w-full h-12 rounded-xl bg-pastel-orange text-[#581E00] font-bold text-[15px] tracking-wide disabled:opacity-60"
          data-testid="mock-draft-start"
        >
          {starting ? 'Seating the AI managers' : `Start the mock draft with ${aiSeats} AI managers`}
        </button>

        <p className="mt-4 text-center text-[12px] text-pressbox-text/45">
          {fromLeague ? (
            <>
              <button type="button" onClick={() => setUseDefaults(true)} className="underline underline-offset-2">
                Draft with Citrus default scoring instead
              </button>
              <span className="mx-2">/</span>
              <Link to={`/league/${fromLeague.id}`} className="underline underline-offset-2">Back to {fromLeague.name}</Link>
            </>
          ) : (
            <>
              {useDefaults && activeLeague && (
                <>
                  <button type="button" onClick={() => setUseDefaults(false)} className="underline underline-offset-2">
                    Use {activeLeague.name}'s scoring
                  </button>
                  <span className="mx-2">/</span>
                </>
              )}
              <Link to="/" className="underline underline-offset-2">Back home</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
