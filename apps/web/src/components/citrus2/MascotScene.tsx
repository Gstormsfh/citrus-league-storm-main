import { MASCOTS } from '@/constants/mascots';
import { LivePulse } from './LivePulse';

/**
 * MascotScene — full hero compositions, NOT corner peeks.
 *
 * Each scene uses a SINGLE pre-rendered hero illustration where the mascot
 * is integrated into a designed environment — character, stat panels,
 * lighting, props all baked into one image. We do NOT layer floating chips
 * or speech bubbles on top of an isolated mascot avatar (that's the lazy
 * sticker pattern). The illustration carries the visual weight; the React
 * component is just a tasteful frame around it.
 *
 * Hero assets live in /public/mascots/scene-*.webp and are sized to fit
 * comfortably under our 5 MB gzipped CI budget (~45 KB each).
 */

type SceneSize = 'md' | 'lg' | 'xl';

const SIZE: Record<SceneSize, { container: string; minHeight: string }> = {
  md: { container: 'aspect-[4/3]', minHeight: 'min-h-[320px] sm:min-h-[400px]' },
  lg: { container: 'aspect-[4/3]', minHeight: 'min-h-[420px] sm:min-h-[520px]' },
  xl: { container: 'aspect-[4/3]', minHeight: 'min-h-[480px] sm:min-h-[600px] lg:min-h-[640px]' },
};

interface SceneProps {
  size?: SceneSize;
  className?: string;
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: STORMY WELCOME
 * Hero asset: /mascots/scene-stormy-welcome.webp
 * Stormy floats in a deep forest scene with volumetric orange spotlight,
 * holographic stat panels, and a hockey rink overlay. All baked into the
 * image — this component is just the frame + overlay tagline.
 * ────────────────────────────────────────────────────────────────────── */

export function StormyWelcomeScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Stormy the narwhal floats among holographic stat panels in a dark hockey arena, welcoming you to Citrus."
    >
      {/* Hero illustration — the entire scene is one image */}
      <img
        src="/mascots/scene-stormy-welcome.webp"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        loading="eager"
      />

      {/* Subtle dark gradient at top + bottom for text legibility on overlays */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 18%, transparent 70%, rgba(15,31,21,0.85) 100%)',
        }}
      />

      {/* Top-left eyebrow */}
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
            Stormy · Assistant GM
          </span>
        </div>
      </div>

      {/* Top-right tagline */}
      <div className="absolute top-5 right-5 sm:top-6 sm:right-6 z-10 hidden sm:block">
        <div className="px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-white/15 backdrop-blur-md">
          <span className="font-jbmono text-[9px] tracking-[0.22em] uppercase text-white/65 font-bold">
            The Citrus Squad
          </span>
        </div>
      </div>

      {/* Bottom signature */}
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10">
        <div className="font-calistoga text-[24px] sm:text-[28px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          Stormy
        </div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">
          Reads every shift · Welcomes you aboard
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: PINEAPPLE STANDBY (legacy frame — to be replaced with generated hero)
 * ────────────────────────────────────────────────────────────────────── */

export function PineappleStandbyScene({ size = 'md', className = '', message }: SceneProps & { message?: string }) {
  const sz = SIZE[size];
  return (
    <div className={`relative overflow-hidden bg-[#152821] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}>
      <div className="absolute top-6 left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-sage/15 ring-1 ring-pastel-sage/40 backdrop-blur-md">
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-sage-soft font-bold">
            In the Crease · Standby
          </span>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={MASCOTS.pineapple.image}
          alt="Pineapple the goaltender, ready in the crease"
          className="w-[60%] max-w-[280px] object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
        />
      </div>

      {message && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 max-w-sm text-center px-4">
          <div className="font-jbmono text-[10px] uppercase tracking-[0.32em] text-pastel-sage-soft font-bold mb-1.5">
            ✦ Quiet Right Now
          </div>
          <p className="font-sans font-bold text-[16px] text-pastel-cream leading-snug">{message}</p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: LEMON ON THE BOARDS (legacy frame — to be replaced with generated hero)
 * ────────────────────────────────────────────────────────────────────── */

export function LemonOnTheBoardsScene({ size = 'lg', className = '', message }: SceneProps & { message?: string }) {
  const sz = SIZE[size];
  return (
    <div className={`relative overflow-hidden bg-[#152821] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}>
      <div className="absolute top-6 left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
            Lemon · Center · #9
          </span>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={MASCOTS.lemon.image}
          alt="Lemon the center, top-line forward"
          className="w-[60%] max-w-[280px] object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
        />
      </div>

      {message && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-sm text-center px-4">
          <p className="font-sans font-bold text-[16px] text-pastel-cream leading-snug">{message}</p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: GM OFFICE COMMAND CENTER (Stormy)
 * Hero asset: /mascots/scene-gm-office.webp
 * ────────────────────────────────────────────────────────────────────── */

export function GMOfficeCommandScene({ size = 'xl', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Stormy the narwhal, in his GM blazer and headset, runs a hockey command center surrounded by holographic stat panels."
    >
      <img src="/mascots/scene-gm-office.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">Stormy · Assistant GM</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">The war room.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Trades · Waivers · Lineup · Analytics — one tap each</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: SCHEDULE SLATE (Pineapple)
 * Hero asset: /mascots/scene-schedule.webp
 * ────────────────────────────────────────────────────────────────────── */

export function ScheduleSlateScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Pineapple the goalie scans a holographic week-at-a-glance schedule wall on hockey ice."
    >
      <img src="/mascots/scene-schedule.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-sage/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-sage-soft font-bold">Pineapple · In the Crease</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Read the slate.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">7-day game density · Back-to-backs flagged</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: ANALYTICS CONSOLE (Lemon)
 * Hero asset: /mascots/scene-analytics.webp
 * ────────────────────────────────────────────────────────────────────── */

export function AnalyticsConsoleScene({ size = 'xl', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Lemon the center forward studies real fantasy hockey data on three floating holographic panels at an executive analytics console."
    >
      <img src="/mascots/scene-analytics.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">Lemon · #9 Center · Studying Tape</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Tape doesn&rsquo;t lie.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Positional grades · vs league avg · stat impact</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: PLAYOFF BRACKET — CUP CHASE (uses existing /mascots/scene-cup.webp)
 * The pre-rendered championship cup illustration repurposed as a
 * bracket-page hero.
 * ────────────────────────────────────────────────────────────────────── */

export function PlayoffBracketScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="The championship cup glints under stadium lights — playoff bracket hero."
    >
      <img src="/mascots/scene-cup.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-amber-400/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-amber-300 font-bold">Postseason · Cup Chase</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Lift the cup.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Bracket · Series · Champions only</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: FREE AGENTS — SCOUTING ROOM (Stormy)
 * Hero asset: /mascots/scene-free-agents.webp
 * Stormy with clipboard in front of a curved holographic wall of
 * free-agent player cards (C / LW / RW / D / G with projection scores,
 * trending pickup pulses, "matches your needs" highlights). Filter
 * bar in the foreground.
 * ────────────────────────────────────────────────────────────────────── */

export function FreeAgentsScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Stormy reviews a curved holographic wall of free-agent player profile cards in his scouting room."
    >
      <img src="/mascots/scene-free-agents.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">Stormy · Scouting Room</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Scout the pool.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Trending · Available · Matches your roster needs</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: STORMY AI ASSISTANT (uses existing /mascots/scene-stormy-ai.webp)
 * Stormy at his AI console — pre-rendered hero, same Sleeper aesthetic.
 * ────────────────────────────────────────────────────────────────────── */

export function StormyAIScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Stormy the narwhal at an AI assistant console, ready to break down your league."
    >
      <img src="/mascots/scene-stormy-ai.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">Stormy · Always-on Assistant GM</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Ask anything.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Trade reads · Start/sit · Roster construction · Waivers</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: LEAGUE LIVE — center-ice puck drop (Stormy vs Lemon)
 * Hero asset: /mascots/scene-league-live.webp
 * Stormy as captain at the faceoff dot, Lemon across, Kiwi at the
 * boards, Pineapple in the crease at the far net. CITRUS LEAGUE
 * jumbotron live in the rafters, fans as cream silhouettes.
 * ────────────────────────────────────────────────────────────────────── */

export function LeagueLiveScene({ size = 'lg', className = '' }: SceneProps & { leagueName?: string }) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Stormy faces off Lemon at center ice. Kiwi watches from the boards, Pineapple guards the far net. The Citrus League jumbotron lights up overhead."
    >
      <img src="/mascots/scene-league-live.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">League · Live</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Drop the puck.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Standings · Matchup · Roster · Pulse</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: CREATE LEAGUE — OPENING NIGHT (Stormy + the squad)
 * Hero asset: /mascots/scene-create-league.webp
 * Stormy on a podium with COMMISSIONER sash, Lemon/Kiwi/Pineapple
 * gathered around an empty ROUND 1 draft board, OPENING NIGHT banner.
 * ────────────────────────────────────────────────────────────────────── */

export function CreateLeagueScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Stormy the narwhal commissions a brand-new league. Lemon, Kiwi, and Pineapple gather around an empty Round 1 draft board, with an Opening Night banner hanging overhead."
    >
      <img src="/mascots/scene-create-league.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">Opening Night · The Citrus Squad</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Commission a fresh league.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Pick your format · Set your scoring · Drop the puck</div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: WAIVER WIRE (Kiwi)
 * Hero asset: /mascots/scene-waivers.webp
 * ────────────────────────────────────────────────────────────────────── */

export function WaiverWireScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#0F1F15] rounded-3xl ring-1 ring-white/10 ${sz.container} ${sz.minHeight} ${className}`}
      role="img"
      aria-label="Kiwi the scrappy forward leaps to grab a player card off a glowing free-agents board, with FAAB budget and claims countdown floating beside."
    >
      <img src="/mascots/scene-waivers.webp" alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(15,31,21,0.55) 0%, transparent 22%, transparent 65%, rgba(15,31,21,0.92) 100%)' }} />
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0F1F15]/70 ring-1 ring-pastel-sage/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-sage-soft font-bold">Kiwi · #22 · Off the Wire</span>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 z-10 max-w-md">
        <div className="font-calistoga text-[26px] sm:text-[34px] text-pastel-cream leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">Snag the difference-maker.</div>
        <div className="font-jbmono text-[9px] sm:text-[10px] uppercase tracking-[0.32em] text-white/70 mt-1.5">Trending pickups · FAAB budget · Claim countdown</div>
      </div>
    </div>
  );
}
