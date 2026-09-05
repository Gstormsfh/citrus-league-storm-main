/**
 * CITRUS GAME DAY, on the home screen (2026-09-05). See gameDayGames.ts.
 *
 * A section head with `FREE TO PLAY` on the right, three tiles across --
 * title over the one-line rule, on the Press Box tile -- and a `JOIN
 * WITH A CODE` line under them. Tiles route to the create screen with
 * the type selected; the line to its Join tab. The section sits under
 * the manager's leagues, because the leagues are why they came and the
 * games are what else there is to do tonight.
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PressBoxSectionHead } from '@/components/pressbox/SectionHead';
import { GAME_DAY_GAMES, GAME_DAY_JOIN_TO } from './gameDayGames';

export function PressBoxGameDay({ className }: { className?: string }) {
  return (
    <section className={className} data-testid="citrus-game-day">
      <PressBoxSectionHead
        title="Citrus Game Day"
        className="px-1 pt-[18px] pb-2"
        action={<span className="font-plex font-medium text-[11px] text-pressbox-orange-soft">FREE TO PLAY</span>}
      />
      <div className="grid grid-cols-3 gap-2">
        {GAME_DAY_GAMES.map((g) => (
          <Link
            key={g.type}
            to={g.to}
            data-testid="game-day-tile"
            data-type={g.type}
            className={cn(
              'focus-citrus block min-h-[84px] p-3 rounded-[12px] bg-pressbox-tile border border-white/[0.08]',
              'flex flex-col justify-end',
            )}
          >
            <span className="block font-condensed font-bold text-[15px] uppercase tracking-[0.06em] text-pressbox-text">{g.title}</span>
            <span className="block mt-0.5 font-barlow text-[11px] leading-[1.25] text-pressbox-text/55">{g.line}</span>
          </Link>
        ))}
      </div>
      <Link
        to={GAME_DAY_JOIN_TO}
        className="focus-citrus block mt-2 px-1 font-plex font-medium text-[11px] tracking-[0.06em] text-pressbox-text/50"
      >
        JOIN WITH A CODE &rsaquo;
      </Link>
    </section>
  );
}

export default PressBoxGameDay;
