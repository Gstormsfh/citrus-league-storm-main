import { type ReactNode } from 'react';
import { MASCOTS, type MascotId } from '@/constants/mascots';
import { LivePulse } from './LivePulse';

/**
 * MascotScene — full hero compositions, NOT decorative corner peeks.
 *
 * Each scene treats a Squad member as the centerpiece of an environmental
 * tableau: ambient orange glow spotlights, parallax floating stat cards
 * (so their "advanced stats" persona shows up in the art itself), brand
 * patterns radiating outward, and a hockey-rink line at the base.
 *
 * Use cases:
 *  - Auth / onboarding (StormyWelcomeScene) — Stormy reading a clipboard
 *  - Empty states (PineappleStandbyScene) — goalie waiting for shots
 *  - 404 / error (LemonMissedShotScene) — center missing the post
 *  - Loading (StormyThinkingScene) — narwhal at her desk
 *
 * The scene composes:
 *  - 1 ambient backdrop (radial gradient + grain)
 *  - 1 subtle hockey rink boards line at the bottom
 *  - 1 large mascot image (320–420px depending on size)
 *  - 1–3 floating "stat cards" in the brand voice (xGF%, line combos, etc.)
 *  - 1 brand pattern (citrus segment radial lines)
 *  - 1 optional speech callout
 *
 * No corner peeks. No 60px avatars. The mascot IS the design.
 */

type SceneSize = 'md' | 'lg' | 'xl';

const SIZE: Record<SceneSize, { container: string; mascot: string }> = {
  md: { container: 'min-h-[360px] sm:min-h-[420px]', mascot: 'w-[200px] h-[200px] sm:w-[260px] sm:h-[260px]' },
  lg: { container: 'min-h-[480px] sm:min-h-[560px]', mascot: 'w-[260px] h-[260px] sm:w-[340px] sm:h-[340px]' },
  xl: { container: 'min-h-[560px] sm:min-h-[640px]', mascot: 'w-[300px] h-[300px] sm:w-[400px] sm:h-[400px]' },
};

interface SceneProps {
  size?: SceneSize;
  className?: string;
}

/* ──────────────────────────────────────────────────────────────────────
 * SHARED SCENE CHROME — used inside every scene below
 * ────────────────────────────────────────────────────────────────────── */

function SceneBackdrop() {
  return (
    <>
      {/* Radial spotlight — orange glow centered slightly above mascot */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 35%, rgba(255,107,26,0.18) 0%, rgba(255,107,26,0.06) 35%, transparent 70%)',
        }}
      />
      {/* Citrus segment pattern radiating from center — brand mark dissolved into background */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none"
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid slice"
      >
        <g stroke="#FF6B1A" strokeWidth="1.5" strokeLinecap="round" fill="none">
          <line x1="400" y1="100" x2="400" y2="500" />
          <line x1="200" y1="300" x2="600" y2="300" />
          <line x1="258" y1="158" x2="542" y2="442" />
          <line x1="542" y1="158" x2="258" y2="442" />
          <line x1="320" y1="120" x2="480" y2="480" />
          <line x1="480" y1="120" x2="320" y2="480" />
        </g>
        <circle cx="400" cy="300" r="220" stroke="#FF6B1A" strokeWidth="1" fill="none" opacity="0.5" />
        <circle cx="400" cy="300" r="160" stroke="#84A57D" strokeWidth="1" fill="none" opacity="0.4" />
      </svg>
      {/* Hockey rink boards line at the bottom — subtle, branded */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
        style={{
          background:
            'linear-gradient(to top, rgba(132,165,125,0.08) 0%, transparent 100%), repeating-linear-gradient(90deg, transparent 0px, transparent 18px, rgba(255,255,255,0.04) 18px, rgba(255,255,255,0.04) 19px)',
        }}
      />
      {/* Subtle grain texture — keeps the dark from feeling flat */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.025] pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </>
  );
}

/**
 * StatChip — small floating chip used inside scenes to show a real-looking
 * advanced-stat snippet. Looks like Stormy's notes coming to life.
 */
function StatChip({
  label,
  value,
  accent = 'orange',
  className = '',
  pulsing = false,
}: {
  label: string;
  value: ReactNode;
  accent?: 'orange' | 'sage' | 'cream';
  className?: string;
  pulsing?: boolean;
}) {
  const accentClass =
    accent === 'orange'
      ? 'ring-pastel-orange/40 bg-pastel-orange/10 text-pastel-orange-soft'
      : accent === 'sage'
      ? 'ring-pastel-sage/40 bg-pastel-sage/10 text-pastel-sage-soft'
      : 'ring-white/15 bg-white/5 text-pastel-cream';
  return (
    <div
      className={`absolute backdrop-blur-md rounded-xl ring-1 px-3 py-2 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)] ${accentClass} ${className}`}
      role="img"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-center gap-1.5 font-jbmono text-[9px] uppercase tracking-[0.18em] font-bold opacity-80">
        {pulsing && <LivePulse size="xs" />}
        {label}
      </div>
      <div className="font-sans font-black text-[18px] leading-none mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

/**
 * SpeechBubble — Stormy/mascot says something. Sits near the mascot.
 */
function SpeechBubble({ children, className = '', tail = 'left' }: { children: ReactNode; className?: string; tail?: 'left' | 'right' }) {
  return (
    <div
      className={`absolute backdrop-blur-md bg-pastel-cream/95 rounded-2xl px-4 py-2.5 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)] ring-1 ring-white/40 max-w-[200px] ${className}`}
    >
      <div className="text-[12px] text-[#0F1F15] font-bold leading-snug">{children}</div>
      <div
        aria-hidden="true"
        className={`absolute bottom-0 ${tail === 'left' ? 'left-6' : 'right-6'} translate-y-[60%]`}
        style={{
          width: 0,
          height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: '12px solid rgba(255,248,240,0.95)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))',
        }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: STORMY WELCOME — used on Auth, Profile Setup, Verify Email
 * ────────────────────────────────────────────────────────────────────── */

export function StormyWelcomeScene({ size = 'lg', className = '' }: SceneProps) {
  const sz = SIZE[size];
  return (
    <div
      className={`relative overflow-hidden bg-[#152821] rounded-3xl ring-1 ring-white/10 ${sz.container} ${className}`}
      role="img"
      aria-label="Stormy the narwhal, Citrus's AI assistant GM, welcoming you"
    >
      <SceneBackdrop />

      {/* Top-left eyebrow — sits inside the scene like a poster header */}
      <div className="absolute top-6 left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
            Stormy · Assistant GM
          </span>
        </div>
      </div>

      {/* MASCOT — centerpiece */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <img
            src={MASCOTS.stormy.image}
            alt=""
            className={`${sz.mascot} object-contain relative z-10 drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]`}
          />
          {/* Glow halo behind mascot */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -m-8 rounded-full blur-3xl opacity-50"
            style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
          />
        </div>
      </div>

      {/* Floating stat chips — give the scene narrative depth */}
      <StatChip
        label="xGF% L10"
        value="58.2"
        accent="orange"
        pulsing
        className="top-12 right-6 sm:top-16 sm:right-12 animate-float-slow"
      />
      <StatChip
        label="PP1 Share"
        value="84%"
        accent="sage"
        className="top-32 right-2 sm:top-40 sm:right-4 animate-float-medium"
      />
      <StatChip
        label="Sims/Night"
        value="19k"
        accent="cream"
        className="bottom-32 left-4 sm:bottom-40 sm:left-12 animate-float-slow"
      />

      {/* Speech bubble */}
      <SpeechBubble className="bottom-20 right-6 sm:bottom-24 sm:right-12" tail="right">
        I read every shift. Welcome aboard.
      </SpeechBubble>

      {/* Bottom signature: rink boards + name */}
      <div className="absolute bottom-4 left-6 z-10">
        <div className="font-calistoga text-[20px] text-pastel-cream leading-none">Stormy</div>
        <div className="font-jbmono text-[9px] uppercase tracking-[0.32em] text-white/45 mt-1">
          The Citrus Squad
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SCENE: PINEAPPLE STANDBY — empty state / goalie at the ready
 * ────────────────────────────────────────────────────────────────────── */

export function PineappleStandbyScene({ size = 'md', className = '', message }: SceneProps & { message?: string }) {
  const sz = SIZE[size];
  return (
    <div className={`relative overflow-hidden bg-[#152821] rounded-3xl ring-1 ring-white/10 ${sz.container} ${className}`}>
      <SceneBackdrop />
      <div className="absolute top-6 left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-sage/15 ring-1 ring-pastel-sage/40 backdrop-blur-md">
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-sage-soft font-bold">
            In the Crease · Standby
          </span>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <img
            src={MASCOTS.pineapple.image}
            alt="Pineapple the goaltender, ready in the crease"
            className={`${sz.mascot} object-contain relative z-10 drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]`}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 -m-8 rounded-full blur-3xl opacity-40"
            style={{ background: 'radial-gradient(circle, #84A57D 0%, transparent 70%)' }}
          />
        </div>
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
 * SCENE: LEMON ON THE BOARDS — celebration / win / live action
 * ────────────────────────────────────────────────────────────────────── */

export function LemonOnTheBoardsScene({ size = 'lg', className = '', message }: SceneProps & { message?: string }) {
  const sz = SIZE[size];
  return (
    <div className={`relative overflow-hidden bg-[#152821] rounded-3xl ring-1 ring-white/10 ${sz.container} ${className}`}>
      <SceneBackdrop />
      <div className="absolute top-6 left-6 z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/40 backdrop-blur-md">
          <LivePulse size="xs" />
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft font-bold">
            Lemon · Center · #9
          </span>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <img
            src={MASCOTS.lemon.image}
            alt="Lemon the center, top-line forward"
            className={`${sz.mascot} object-contain relative z-10 drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]`}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 -m-8 rounded-full blur-3xl opacity-50"
            style={{ background: 'radial-gradient(circle, #FF6B1A 0%, transparent 70%)' }}
          />
        </div>
      </div>

      <StatChip label="G L10" value="7" accent="orange" pulsing className="top-16 right-6 animate-float-medium" />
      <StatChip label="TOI" value="22:18" accent="sage" className="top-36 right-4 animate-float-slow" />

      {message && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-sm text-center px-4">
          <p className="font-sans font-bold text-[16px] text-pastel-cream leading-snug">{message}</p>
        </div>
      )}
    </div>
  );
}
