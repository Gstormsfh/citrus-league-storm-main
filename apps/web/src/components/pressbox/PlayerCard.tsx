/**
 * THE PLAYER CARD (artboard 1a).
 *
 * A full-screen takeover, and the only Press Box surface with a coloured
 * ground: a 240px wash of the player's TEAM COLOUR at 28% over the scanline.
 * It is the one screen that is about a person rather than a competition, and
 * the colour is how you know whose card you opened before you have read a
 * word of it.
 *
 * THE ORDER IS AN ARGUMENT, and it is not the order a stats site would use.
 *
 *   1. WHO OWNS HIM (`→ GSTORMS · C · #97`) comes before the name. On a
 *      fantasy screen the first question about any player is whether he is
 *      yours, someone else's, or free — every action below depends on the
 *      answer, and putting it in an eyebrow above the name means it is read
 *      first without competing for size.
 *   2. THE ACTIONS come before the numbers. You opened this card to do
 *      something; the stats are how you decide, but the decision is already
 *      half made or you would not be here. `DROP` is grapefruit-outlined
 *      rather than filled — destructive, available, not inviting.
 *   3. FOUR TILES, then the log. `WK 1 PTS` (what he did for you), `SZN
 *      PROJ` (what he is worth), `POS RANK` (against his own position, which
 *      is the only comparison that means anything), and `xG ± / 60` — the
 *      Citrus number, the one a manager cannot get anywhere else, in orange
 *      because it is the reason this app exists.
 *   4. UPCOMING, then Stormy. The schedule is what the decision actually
 *      turns on, and the note explains the tiles rather than repeating them.
 *
 * Every figure arrives as a prop and every optional one is omitted rather
 * than faked: a card with no projection shows no projection.
 */
import { cn } from '@/lib/utils';
import { onTeamColor } from '@/utils/teamColorContrast';
import { PB_TYPE } from './rowScale';
import { SCANLINE } from './chromeMetrics';

/* ── hero ──────────────────────────────────────────────────────────── */

export interface PressBoxPlayerVital {
  label: string;
  value: string;
}

export interface PressBoxPlayerCardHeroProps {
  /** `Connor` / `McDavid`. Two lines on the artboard, and it needs both. */
  firstName: string;
  lastName: string;
  /** `→ GSTORMS`, `FREE AGENT`, `→ PUCK NORRIS`. */
  ownerLine?: string | null;
  position?: string | null;
  jersey?: string | null;
  teamAbbreviation?: string | null;
  teamColor?: string | null;
  headshotUrl?: string | null;
  vitals?: PressBoxPlayerVital[];
  onClose?: () => void;
  className?: string;
}

export function PressBoxPlayerCardHero({
  firstName,
  lastName,
  ownerLine,
  position,
  jersey,
  teamAbbreviation,
  teamColor,
  headshotUrl,
  vitals = [],
  onClose,
  className,
}: PressBoxPlayerCardHeroProps) {
  return (
    <div className={cn(PB_TYPE, 'flex items-start gap-3', className)}>
      <div
        className="relative flex-none w-[84px] h-[84px] rounded-[14px] border-[1.5px] border-white/[0.16] bg-pressbox-tile-high overflow-visible"
      >
        {headshotUrl ? (
          <img
            src={headshotUrl}
            alt=""
            className="w-full h-full object-cover rounded-[13px]"
            loading="lazy"
          />
        ) : (
          <span className="absolute inset-x-0 bottom-1.5 text-center font-plex font-medium text-[8px] text-pressbox-text/50">
            HEADSHOT
          </span>
        )}
        {teamAbbreviation && (
          <span
            aria-hidden="true"
            /* The one place in Press Box where a team's own colour is a FILL
               rather than a ring, and it is the artboard's: a 24px identity
               badge is not a row or a bar, so it cannot flatten the tile
               ladder. NHL hexes run from #00205B to #FFB81C, so the ink is
               MEASURED per colour by `onTeamColor` rather than assumed —
               cream would vanish on half of them. darkThemeContrastGuard
               allows the fill exactly on that condition. */
            className="absolute -right-1.5 -bottom-1.5 w-6 h-6 rounded-full border-2 border-pressbox-surface flex items-center justify-center font-condensed font-extrabold text-[9px]"
            style={{ background: teamColor ?? '#2a3a30', color: onTeamColor(teamColor ?? '#2a3a30') }}
          >
            {teamAbbreviation}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {(ownerLine || position || jersey) && (
          <p className="font-plex font-semibold text-[10px] tracking-[0.1em] text-pressbox-orange-soft truncate">
            {ownerLine}
            {ownerLine && position ? ' · ' : ''}
            {position && <span className="text-pressbox-sage">{position}</span>}
            {jersey ? ` · ${jersey}` : ''}
          </p>
        )}
        <h1 className="mt-1 font-condensed font-extrabold text-[30px] leading-none uppercase tracking-[0.01em] text-pressbox-text">
          {firstName}
          <br />
          {lastName}
        </h1>
        {vitals.length > 0 && (
          <dl className="flex gap-3.5 mt-2 font-plex font-medium text-[9px] tracking-[0.06em] text-pressbox-text/50">
            {vitals.map((v) => (
              <div key={v.label}>
                <dt>{v.label}</dt>
                <dd className="mt-0.5 font-semibold text-[14px] text-pressbox-text">{v.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close player card"
          className="focus-citrus relative flex-none w-5 text-right text-[16px] leading-none text-pressbox-text/60 after:absolute after:-inset-y-3 after:-inset-x-3 after:content-['']"
        >
          &#10005;
        </button>
      )}
    </div>
  );
}

/* ── the coloured ground ───────────────────────────────────────────── */

export function pressBoxPlayerCardGround(teamColor?: string | null): React.CSSProperties {
  // `47` is 28% in hex — the artboard's `rgba(255,75,0,.28)` with EDM's colour
  // substituted for whoever's card this is. The wash dies at 240px, so the
  // screen is the team's at the top and Press Box's everywhere else.
  const c = teamColor ?? '#FF6B1A';
  return {
    backgroundImage: [
      `linear-gradient(180deg, ${c}47, rgba(12,24,17,0) 240px)`,
      SCANLINE.backgroundImage as string,
    ].join(', '),
  };
}

/* ── stat tiles ────────────────────────────────────────────────────── */

export interface PressBoxStatTile {
  key: string;
  label: string;
  value: string;
  tone?: 'sage' | 'orange' | 'plain';
  onClick?: () => void;
}

export function PressBoxStatTiles({ tiles, className }: { tiles: PressBoxStatTile[]; className?: string }) {
  if (tiles.length === 0) return null;
  return (
    <div className={cn(PB_TYPE, 'grid grid-cols-4 gap-1.5', className)}>
      {tiles.map((t) => (
        <div key={t.key} className="p-2 rounded-[10px] bg-pressbox-tile border border-white/[0.08]">
          <p className="font-plex font-medium text-[8px] tracking-[0.08em] text-pressbox-text/45 truncate">
            {t.label}
          </p>
          <p
            className={cn(
              'mt-[3px] font-plex font-semibold text-[18px] tabular-nums',
              t.tone === 'sage' && 'text-pressbox-sage',
              t.tone === 'orange' && 'text-pressbox-orange-soft',
              (!t.tone || t.tone === 'plain') && 'text-pressbox-text',
            )}
          >
            {t.onClick ? <button type="button" onClick={t.onClick} className="focus-citrus underline decoration-dotted underline-offset-4" aria-label={`${t.label} breakdown`}>{t.value}</button> : t.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ── game log ──────────────────────────────────────────────────────── */

export interface PressBoxGameLogRow {
  key: string;
  date: string;
  opponent: string;
  points?: number | null;
  /** Shown in place of the points figure — `DNP` on a played date with no line. */
  pointsLabel?: string;
  cells: (string | number)[];
  /** The tail column: TOI on a played row, the likely range on a projected one. */
  toi?: string | null;
  /** The most recent game takes a sage wash. */
  latest?: boolean;
  /** The AVG footer row. */
  summary?: boolean;
}

export interface PressBoxGameLogProps {
  /** `['G','A','SOG','+/-','PPP','HIT']`. Drives the grid's flexible columns. */
  statHeadings: string[];
  rows: PressBoxGameLogRow[];
  /** `FPTS` for a played log; `PROJ` for the remaining games. */
  pointsHeading?: string;
  showPoints?: boolean;
  showTail?: boolean;
  /** The tail column's heading and width: TOI at 34px unless the table says otherwise. */
  tail?: { heading: string; width: number };
  className?: string;
}

export function PressBoxGameLog({
  statHeadings,
  rows,
  pointsHeading = 'FPTS',
  showPoints = true,
  showTail = true,
  tail = { heading: 'TOI', width: 34 },
  className,
}: PressBoxGameLogProps) {
  // The artboard draws DT at 30px, which fits `9/30` and not `10/10`; 34px
  // fits every date a season has (2026-09-04).
  const cols = `34px 44px ${showPoints ? '44px' : ''} ${statHeadings.map(() => '1fr').join(' ')} ${showTail ? `${tail.width}px` : ''}`;
  return (
    <div
      className={cn(
        PB_TYPE,
        'rounded-[12px] bg-pressbox-tile border border-white/[0.08] overflow-hidden font-plex tabular-nums',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="grid px-2.5 py-2 font-semibold text-[8px] tracking-[0.06em] text-pressbox-text/45 border-b border-white/[0.08]"
        style={{ gridTemplateColumns: cols }}
      >
        <span>DT</span>
        <span>OPP</span>
        {showPoints && <span className="text-pressbox-sage">{pointsHeading}</span>}
        {statHeadings.map((h) => (
          <span key={h} className="text-center">
            {h}
          </span>
        ))}
        {showTail && <span className="text-right">{tail.heading}</span>}
      </div>

      {rows.map((r) => (
        <div
          key={r.key}
          className={cn(
            'grid px-2.5 py-2 font-medium text-[11px] border-b border-white/[0.05]',
            r.latest && 'bg-pressbox-sage/[0.06]',
            r.summary && 'text-pressbox-text/70',
          )}
          style={{ gridTemplateColumns: cols }}
        >
          <span className="text-pressbox-text/50">{r.date}</span>
          <span className="text-pressbox-text">{r.opponent}</span>
          {showPoints && <span
            className={cn(
              'font-semibold',
              r.summary ? 'text-pressbox-orange-soft' : r.latest ? 'text-pressbox-sage' : 'text-pressbox-text',
            )}
          >
            {r.pointsLabel ?? (r.points == null ? '–' : r.points.toFixed(1))}
          </span>}
          {r.cells.map((c, i) => (
            <span key={i} className="text-center text-pressbox-text">
              {c}
            </span>
          ))}
          {showTail && <span className="text-right text-pressbox-text/50">{r.toi ?? '–'}</span>}
        </div>
      ))}
    </div>
  );
}

/* ── upcoming ──────────────────────────────────────────────────────── */

export interface PressBoxUpcomingGame {
  key: string;
  /** `SAT 10/3`. */
  when: string;
  /** `@ CGY`. */
  opponent: string;
  /** `7.1 PROJ · B2B`. */
  note?: string | null;
  /** The tail of `note` that is a schedule advantage, in sage. */
  noteTail?: string | null;
}

export function PressBoxUpcomingCards({ games, className }: { games: PressBoxUpcomingGame[]; className?: string }) {
  if (games.length === 0) return null;
  return (
    <div className={cn(PB_TYPE, 'flex gap-1.5', className)}>
      {games.slice(0, 3).map((g) => (
        <div
          key={g.key}
          className="flex-1 min-w-0 p-2 rounded-[10px] bg-pressbox-tile border border-white/[0.08] font-plex font-medium text-[9px] text-pressbox-text/50"
        >
          <p className="truncate">{g.when}</p>
          <p className="mt-[3px] font-barlow font-bold text-[13px] text-pressbox-text truncate">{g.opponent}</p>
          {(g.note || g.noteTail) && (
            <p className="mt-0.5 text-pressbox-orange-soft truncate">
              {g.note}
              {g.noteTail && <span className="text-pressbox-sage">{g.note ? ' ' : ''}{g.noteTail}</span>}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── the note ──────────────────────────────────────────────────────── */

export interface PressBoxNoteCardProps {
  /** `STORMY · xG READ`. */
  eyebrow: string;
  body: string;
  avatarSrc?: string | null;
  className?: string;
}

export function PressBoxNoteCard({ eyebrow, body, avatarSrc, className }: PressBoxNoteCardProps) {
  return (
    <div
      className={cn(
        PB_TYPE,
        'flex gap-2.5 px-3 py-2.5 rounded-[12px] bg-pressbox-tile border border-white/[0.08]',
        className,
      )}
    >
      {avatarSrc && (
        <img src={avatarSrc} alt="" className="w-[30px] h-[30px] flex-none rounded-full object-cover" />
      )}
      <div className="min-w-0">
        <p className="font-plex font-semibold text-[9px] tracking-[0.1em] text-pressbox-orange-soft">{eyebrow}</p>
        <p className="mt-[3px] font-barlow text-[12px] leading-[1.45] text-pressbox-text/85">{body}</p>
      </div>
    </div>
  );
}
